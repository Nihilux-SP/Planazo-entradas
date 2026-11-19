package com.planazo.entradas.controller;

import com.planazo.entradas.model.*;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.util.UriComponentsBuilder;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.util.LinkedMultiValueMap;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.net.URI;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@RestController
@RequestMapping("/api")
public class ApiController {
    private final JdbcTemplate jdbc;
    private final SecretKey jwtKey;
    private final RestClient restClient = RestClient.builder().build();
    private final Map<String, Instant> oauthStates = new ConcurrentHashMap<>();
    private final String githubClientId;
    private final String githubClientSecret;
    private final String googleClientId;
    private final String googleClientSecret;
    private final String oauthRedirectUri;
    private final String frontendUri;
    private final BCryptPasswordEncoder passwordEncoder = new BCryptPasswordEncoder(12);
    private final Set<String> revokedTokens = ConcurrentHashMap.newKeySet();
    private static final long ACCESS_TOKEN_MINUTES = 15;
    private static final long REFRESH_TOKEN_DAYS = 7;

    public ApiController(JdbcTemplate jdbc, @Value("${app.auth.jwt-secret}") String secret,
                         @Value("${app.auth.oauth.github.client-id}") String githubClientId,
                         @Value("${app.auth.oauth.github.client-secret}") String githubClientSecret,
                         @Value("${app.auth.oauth.google.client-id}") String googleClientId,
                         @Value("${app.auth.oauth.google.client-secret}") String googleClientSecret,
                         @Value("${app.auth.oauth.redirect-uri}") String oauthRedirectUri,
                         @Value("${app.auth.oauth.frontend-uri}") String frontendUri) {
        this.jdbc = jdbc;
        this.jwtKey = Keys.hmacShaKeyFor(Base64.getDecoder().decode(secret));
        this.githubClientId = githubClientId;
        this.githubClientSecret = githubClientSecret;
        this.googleClientId = googleClientId;
        this.googleClientSecret = googleClientSecret;
        this.oauthRedirectUri = oauthRedirectUri;
        this.frontendUri = frontendUri;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("status", "ok", "service", "planazo-api", "runtime", "spring-boot");
    }

    @GetMapping("/stats")
    public Map<String, Object> stats() {
        return Map.of(
            "events", jdbc.queryForObject("SELECT COUNT(*) FROM events", Long.class),
            "cities", jdbc.queryForObject("SELECT COUNT(DISTINCT city) FROM events", Long.class),
            "bookings", jdbc.queryForObject("SELECT COUNT(*) FROM bookings", Long.class),
            "users", jdbc.queryForObject("SELECT COUNT(*) FROM users", Long.class));
    }

    @GetMapping("/events")
    public Map<String, Object> events(@RequestParam(defaultValue = "") String search,
                                      @RequestParam(defaultValue = "Todos") String type,
                                      @RequestParam(defaultValue = "Todas") String city,
                                      @RequestParam(defaultValue = "date") String sort) {
        String query = normalize(search);
        Comparator<Event> comparator = switch (sort) {
            case "price-asc" -> Comparator.comparingInt(Event::price);
            case "price-desc" -> Comparator.comparingInt(Event::price).reversed();
            case "title" -> Comparator.comparing(Event::title, String.CASE_INSENSITIVE_ORDER);
            default -> Comparator.comparing(Event::date).thenComparing(Event::time);
        };
        List<Event> result = allEvents().stream()
            .filter(e -> "Todos".equals(type) || e.type().equals(type))
            .filter(e -> "Todas".equals(city) || e.city().equals(city))
            .filter(e -> query.isBlank() || normalize(e.title() + " " + e.venue() + " " + e.city()).contains(query))
            .sorted(comparator)
            .toList();
        return Map.of("data", result, "total", result.size());
    }

    @GetMapping("/events/featured")
    public Map<String, Object> featured() {
        return Map.of("data", allEvents().stream().filter(Event::featured).toList());
    }

    @GetMapping("/events/{id}")
    public Map<String, Object> event(@PathVariable long id) {
        return Map.of("data", findEvent(id));
    }

    @PostMapping("/events")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createEvent(@Valid @RequestBody EventRequest request,
                                            @RequestHeader("Authorization") String authorization) {
        requireRole(authorization, "ADMIN", "GESTOR");
        long id = jdbc.queryForObject("SELECT COALESCE(MAX(id),0)+1 FROM events", Long.class);
        jdbc.update("INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?)", id, request.type(), request.title(),
            request.venue(), request.city(), request.date(), request.time(), request.price(), request.image(),
            request.accent(), request.featured());
        return Map.of("data", findEvent(id));
    }

    @PutMapping("/events/{id}")
    public Map<String, Object> updateEvent(@PathVariable long id, @Valid @RequestBody EventRequest request,
                                           @RequestHeader("Authorization") String authorization) {
        requireRole(authorization, "ADMIN", "GESTOR");
        findEvent(id);
        jdbc.update("""
            UPDATE events SET type=?,title=?,venue=?,city=?,event_date=?,event_time=?,price=?,image=?,accent=?,featured=?
            WHERE id=?
            """, request.type(), request.title(), request.venue(), request.city(), request.date(), request.time(),
            request.price(), request.image(), request.accent(), request.featured(), id);
        return Map.of("data", findEvent(id));
    }

    @DeleteMapping("/events/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteEvent(@PathVariable long id, @RequestHeader("Authorization") String authorization) {
        requireRole(authorization, "ADMIN", "GESTOR");
        findEvent(id);
        try {
            jdbc.update("DELETE FROM events WHERE id=?", id);
        } catch (DataIntegrityViolationException exception) {
            throw new ApiException(HttpStatus.CONFLICT,
                "No se puede eliminar el evento porque tiene reservas o favoritos asociados");
        }
    }

    @PostMapping("/auth/register")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> register(@Valid @RequestBody AuthRequest request) {
        String email = request.email().toLowerCase(Locale.ROOT);
        try {
            jdbc.update("INSERT INTO users(email,password_hash,role,created_at) VALUES (?,?,?,CURRENT_TIMESTAMP)",
                email, passwordEncoder.encode(request.password()), "CLIENTE");
        } catch (DuplicateKeyException exception) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "El email ya está registrado");
        }
        long id = jdbc.queryForObject("SELECT MAX(id) FROM users WHERE email=?", Long.class, email);
        Map<String, Object> response = new LinkedHashMap<>(tokenResponse(new User(id, email, "CLIENTE")));
        response.put("message", "Cuenta creada correctamente");
        return response;
    }

    @PostMapping("/auth/login")
    public Map<String, Object> login(@Valid @RequestBody AuthRequest request) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM users WHERE email=?",
            request.email().toLowerCase(Locale.ROOT));
        if (rows.isEmpty() || !passwordEncoder.matches(request.password(), (String) rows.get(0).get("PASSWORD_HASH"))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Email o contraseña incorrectos");
        }
        long id = ((Number) rows.get(0).get("ID")).longValue();
        User user = new User(id, (String) rows.get(0).get("EMAIL"), (String) rows.get(0).get("ROLE"));
        return tokenResponse(user);
    }

    @GetMapping("/auth/oauth/{provider}")
    public ResponseEntity<Void> startOAuth(@PathVariable String provider) {
        OAuthProvider oauth = oauthProvider(provider);
        if (!oauth.configured()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,
                "El inicio de sesión con " + oauth.name() + " no está configurado");
        }
        String state = UUID.randomUUID().toString();
        oauthStates.put(state, Instant.now().plus(10, ChronoUnit.MINUTES));
        String authorizationUrl = UriComponentsBuilder.fromUriString(oauth.authorizationEndpoint())
            .queryParam("client_id", oauth.clientId())
            .queryParam("redirect_uri", callbackUri(provider))
            .queryParam("response_type", "code")
            .queryParam("scope", oauth.scope())
            .queryParam("state", state)
            .build().encode().toUriString();
        return ResponseEntity.status(HttpStatus.FOUND).location(URI.create(authorizationUrl)).build();
    }

    @GetMapping("/auth/oauth/{provider}/callback")
    public ResponseEntity<Void> finishOAuth(@PathVariable String provider,
                                             @RequestParam String code,
                                             @RequestParam String state) {
        OAuthProvider oauth = oauthProvider(provider);
        Instant expiresAt = oauthStates.remove(state);
        if (expiresAt == null || expiresAt.isBefore(Instant.now())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "La solicitud de inicio de sesión no es válida o ha caducado");
        }
        if (!oauth.configured()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,
                "El inicio de sesión con " + oauth.name() + " no está configurado");
        }
        try {
            JsonNode profile = profile(oauth, exchangeCode(oauth, provider, code));
            String email = profile.path("email").asText("").trim().toLowerCase(Locale.ROOT);
            if (email.isBlank() || ("Google".equals(oauth.name()) && !profile.path("email_verified").asBoolean(false))) {
                throw new ApiException(HttpStatus.BAD_REQUEST,
                "El proveedor no ha proporcionado un email verificable");
            }
            User user = findOrCreateOAuthUser(email);
            Map<String, Object> session = tokenResponse(user);
            String redirect = UriComponentsBuilder.fromUriString(frontendUri)
                .fragment("oauth_token=" + session.get("token") + "&oauth_refresh_token=" + session.get("refreshToken"))
                .build().toUriString();
            return ResponseEntity.status(HttpStatus.FOUND).location(URI.create(redirect)).build();
        } catch (ApiException exception) {
            return oauthErrorRedirect(exception.getMessage());
        } catch (RestClientException | IllegalStateException exception) {
            return oauthErrorRedirect("No se pudo completar el inicio de sesión con " + oauth.name());
        }
    }

    private ResponseEntity<Void> oauthErrorRedirect(String message) {
        String redirect = UriComponentsBuilder.fromUriString(frontendUri)
            .fragment("oauth_error=" + message)
            .build().toUriString();
        return ResponseEntity.status(HttpStatus.FOUND).location(URI.create(redirect)).build();
    }

    @PostMapping("/auth/refresh")
    public Map<String, Object> refresh(@Valid @RequestBody RefreshRequest request) {
        String tokenHash = sha256(request.refreshToken());
        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT r.user_id,u.email,u.role FROM refresh_tokens r
            JOIN users u ON u.id=r.user_id
            WHERE r.token_hash=? AND r.revoked_at IS NULL AND r.expires_at>CURRENT_TIMESTAMP
            """, tokenHash);
        if (rows.isEmpty()) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "El refresh token no es válido o ha caducado");
        }
        jdbc.update("UPDATE refresh_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?", tokenHash);
        User user = new User(((Number) rows.get(0).get("USER_ID")).longValue(),
            (String) rows.get(0).get("EMAIL"), (String) rows.get(0).get("ROLE"));
        return tokenResponse(user);
    }

    @GetMapping("/auth/me")
    public Map<String, Object> me(@RequestHeader("Authorization") String authorization) {
        return Map.of("user", requireUser(authorization));
    }

    @PostMapping("/auth/logout")
    public Map<String, String> logout(@RequestHeader(value = "Authorization", required = false) String authorization,
                                      @RequestParam(required = false) String refreshToken) {
        if (authorization != null && authorization.startsWith("Bearer ")) revokedTokens.add(authorization.substring(7).trim());
        if (refreshToken != null && !refreshToken.isBlank()) {
            jdbc.update("UPDATE refresh_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?",
                sha256(refreshToken));
        }
        return Map.of("message", "Sesión cerrada");
    }

    @PatchMapping("/auth/users/{id}/role")
    public Map<String, Object> changeRole(@PathVariable long id, @RequestParam String role,
                                          @RequestHeader("Authorization") String authorization) {
        requireRole(authorization, "ADMIN");
        if (!Set.of("ADMIN", "GESTOR", "CLIENTE").contains(role)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "El rol no es válido");
        }
        int updated = jdbc.update("UPDATE users SET role=? WHERE id=?", role, id);
        if (updated == 0) throw new ApiException(HttpStatus.NOT_FOUND, "El usuario no existe");
        Map<String, Object> row = jdbc.queryForMap("SELECT id,email,role FROM users WHERE id=?", id);
        return Map.of("user", new User(((Number) row.get("ID")).longValue(),
            (String) row.get("EMAIL"), (String) row.get("ROLE")));
    }

    @PostMapping("/bookings")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> booking(@Valid @RequestBody BookingRequest request,
                                       @RequestHeader("Authorization") String authorization) {
        User user = requireUser(authorization);
        findEvent(request.eventId());
        Timestamp now = Timestamp.from(Instant.now());
        jdbc.update("INSERT INTO bookings(user_id,event_id,quantity,created_at) VALUES (?,?,?,?)",
            user.id(), request.eventId(), request.quantity(), now);
        Long id = jdbc.queryForObject("SELECT MAX(id) FROM bookings WHERE user_id=?", Long.class, user.id());
        Map<String, Object> data = Map.of("id", id, "eventId", request.eventId(),
            "quantity", request.quantity(), "createdAt", now.toInstant().toString());
        return Map.of("data", data, "message", "Reserva confirmada para " + request.quantity()
            + " entrada" + (request.quantity() == 1 ? "" : "s") + ".");
    }

    @GetMapping("/bookings/me")
    public List<Map<String, Object>> myBookings(@RequestHeader("Authorization") String authorization) {
        User user = requireUser(authorization);
        return jdbc.query("""
            SELECT b.id, b.event_id, b.quantity, b.created_at, e.title, e.venue, e.city,
                   e.event_date, e.event_time, e.price, e.image, e.accent
            FROM bookings b JOIN events e ON e.id=b.event_id
            WHERE b.user_id=? ORDER BY b.created_at DESC
            """, (rs, row) -> Map.ofEntries(
            Map.entry("id", rs.getLong("id")),
            Map.entry("eventId", rs.getLong("event_id")),
            Map.entry("quantity", rs.getInt("quantity")),
            Map.entry("createdAt", Objects.toString(rs.getString("created_at"), "")),
            Map.entry("title", rs.getString("title")),
            Map.entry("venue", rs.getString("venue")),
            Map.entry("city", rs.getString("city")),
            Map.entry("eventDate", rs.getString("event_date")),
            Map.entry("eventTime", rs.getString("event_time")),
            Map.entry("price", rs.getInt("price")),
            Map.entry("image", rs.getString("image")),
            Map.entry("accent", rs.getString("accent"))), user.id());
    }

    @DeleteMapping("/bookings/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void cancelBooking(@PathVariable long id, @RequestHeader("Authorization") String authorization) {
        User user = requireUser(authorization);
        if (jdbc.update("DELETE FROM bookings WHERE id=? AND user_id=?", id, user.id()) == 0) {
            throw new ApiException(HttpStatus.NOT_FOUND, "La reserva no existe");
        }
    }

    @GetMapping("/favorites")
    public List<Long> favorites(@RequestHeader("Authorization") String authorization) {
        User user = requireUser(authorization);
        return jdbc.queryForList("SELECT event_id FROM favorites WHERE user_id=? ORDER BY created_at DESC",
            Long.class, user.id());
    }

    @PostMapping("/favorites/{eventId}")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> addFavorite(@PathVariable long eventId,
                                           @RequestHeader("Authorization") String authorization) {
        User user = requireUser(authorization);
        findEvent(eventId);
        jdbc.update("MERGE INTO favorites(user_id,event_id,created_at) KEY(user_id,event_id) VALUES (?,?,CURRENT_TIMESTAMP)",
            user.id(), eventId);
        return Map.of("eventId", eventId, "message", "Añadido a tus favoritos");
    }

    @DeleteMapping("/favorites/{eventId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void removeFavorite(@PathVariable long eventId, @RequestHeader("Authorization") String authorization) {
        User user = requireUser(authorization);
        jdbc.update("DELETE FROM favorites WHERE user_id=? AND event_id=?", user.id(), eventId);
    }

    @GetMapping("/auth/users")
    public Map<String, Object> users(@RequestHeader("Authorization") String authorization) {
        requireRole(authorization, "ADMIN");
        List<Map<String, Object>> data = jdbc.query("SELECT id,email,role,created_at FROM users ORDER BY id",
            (rs, row) -> Map.of(
                "id", rs.getLong("id"),
                "email", rs.getString("email"),
                "role", rs.getString("role"),
                "createdAt", Objects.toString(rs.getString("created_at"), "")));
        return Map.of("data", data, "total", data.size());
    }

    private List<Event> allEvents() {
        return jdbc.query("SELECT * FROM events ORDER BY event_date,event_time", (rs, row) ->
            new Event(rs.getLong("id"), rs.getString("type"), rs.getString("title"), rs.getString("venue"),
                rs.getString("city"), rs.getString("event_date"), rs.getString("event_time"), rs.getInt("price"),
                rs.getString("image"), rs.getString("accent"), rs.getBoolean("featured")));
    }

    private Event findEvent(long id) {
        return allEvents().stream().filter(event -> event.id() == id).findFirst()
            .orElseThrow(() -> new ApiException(HttpStatus.BAD_REQUEST, "El evento no existe"));
    }

    private User requireRole(String authorization, String... allowedRoles) {
        User user = requireUser(authorization);
        if (Arrays.stream(allowedRoles).noneMatch(user.role()::equals)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "No tienes permisos para esta operación");
        }
        return user;
    }

    private User requireUser(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Debes iniciar sesión");
        }
        String token = authorization.substring(7).trim();
        if (revokedTokens.contains(token)) throw new ApiException(HttpStatus.UNAUTHORIZED, "La sesión ha caducado");
        try {
            Claims claims = Jwts.parser().verifyWith(jwtKey).build().parseSignedClaims(token).getPayload();
            long userId = Long.parseLong(claims.getSubject());
            Map<String, Object> row = jdbc.queryForMap("SELECT email,role FROM users WHERE id=?", userId);
            return new User(userId, (String) row.get("EMAIL"), (String) row.get("ROLE"));
        } catch (Exception exception) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "El token no es válido o ha caducado");
        }
    }

    private static String normalize(String value) {
        return java.text.Normalizer.normalize(value == null ? "" : value.trim().toLowerCase(Locale.ROOT),
            java.text.Normalizer.Form.NFD).replaceAll("\\p{M}", "");
    }

    private Map<String, Object> tokenResponse(User user) {
        Instant now = Instant.now();
        String accessToken = Jwts.builder().subject(Long.toString(user.id()))
            .claim("email", user.email()).claim("role", user.role())
            .issuedAt(Date.from(now)).expiration(Date.from(now.plus(ACCESS_TOKEN_MINUTES, ChronoUnit.MINUTES)))
            .signWith(jwtKey).compact();
        String refreshToken = UUID.randomUUID() + "." + UUID.randomUUID();
        jdbc.update("INSERT INTO refresh_tokens(user_id,token_hash,expires_at) VALUES (?,?,?)",
            user.id(), sha256(refreshToken), Timestamp.from(now.plus(REFRESH_TOKEN_DAYS, ChronoUnit.DAYS)));
        return Map.of("token", accessToken, "refreshToken", refreshToken, "expiresIn", ACCESS_TOKEN_MINUTES * 60,
            "user", user);
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 no está disponible", exception);
        }
    }

    private OAuthProvider oauthProvider(String provider) {
        return switch (provider.toLowerCase(Locale.ROOT)) {
            case "github" -> new OAuthProvider("GitHub", githubClientId, githubClientSecret,
                "https://github.com/login/oauth/authorize", "https://github.com/login/oauth/access_token",
                "read:user user:email");
            case "google" -> new OAuthProvider("Google", googleClientId, googleClientSecret,
                "https://accounts.google.com/o/oauth2/v2/auth", "https://oauth2.googleapis.com/token",
                "openid email profile");
            default -> throw new ApiException(HttpStatus.NOT_FOUND, "Proveedor de inicio de sesión no disponible");
        };
    }

    private String callbackUri(String provider) {
        return oauthRedirectUri.replace("{provider}", provider);
    }

    private String exchangeCode(OAuthProvider oauth, String provider, String code) {
        LinkedMultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("client_id", oauth.clientId());
        form.add("client_secret", oauth.clientSecret());
        form.add("code", code);
        form.add("redirect_uri", callbackUri(provider));
        form.add("grant_type", "authorization_code");
        JsonNode response = restClient.post().uri(oauth.tokenEndpoint())
            .contentType(org.springframework.http.MediaType.APPLICATION_FORM_URLENCODED)
            .header("Accept", "application/json")
            .body(form).retrieve().body(JsonNode.class);
        if (response == null || response.path("access_token").asText("").isBlank()) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "El proveedor no ha devuelto un token válido");
        }
        return response.path("access_token").asText();
    }

    private JsonNode profile(OAuthProvider oauth, String accessToken) {
        if ("GitHub".equals(oauth.name())) {
            JsonNode user = restClient.get().uri("https://api.github.com/user")
                .header("Authorization", "Bearer " + accessToken)
                .header("Accept", "application/vnd.github+json").retrieve().body(JsonNode.class);
            JsonNode emails = restClient.get().uri("https://api.github.com/user/emails")
                .header("Authorization", "Bearer " + accessToken)
                .header("Accept", "application/vnd.github+json").retrieve().body(JsonNode.class);
            if (emails != null && emails.isArray()) {
                for (JsonNode email : emails) {
                    if (email.path("verified").asBoolean(false) && email.path("primary").asBoolean(false)) return email;
                }
            }
            if (user != null && !user.path("email").asText("").isBlank()) return user;
            return com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode();
        }
        return restClient.get().uri("https://openidconnect.googleapis.com/v1/userinfo")
            .header("Authorization", "Bearer " + accessToken).retrieve().body(JsonNode.class);
    }

    private User findOrCreateOAuthUser(String email) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT id,email,role FROM users WHERE email=?", email);
        if (rows.isEmpty()) {
            String unusablePassword = "oauth-" + UUID.randomUUID() + "-" + UUID.randomUUID();
            jdbc.update("INSERT INTO users(email,password_hash,role,created_at) VALUES (?,?,?,CURRENT_TIMESTAMP)",
                email, passwordEncoder.encode(unusablePassword), "CLIENTE");
            rows = jdbc.queryForList("SELECT id,email,role FROM users WHERE email=?", email);
        }
        Map<String, Object> row = rows.get(0);
        return new User(((Number) row.get("ID")).longValue(), (String) row.get("EMAIL"), (String) row.get("ROLE"));
    }

    private record OAuthProvider(String name, String clientId, String clientSecret,
                                 String authorizationEndpoint, String tokenEndpoint, String scope) {
        boolean configured() {
            return clientId != null && !clientId.isBlank() && clientSecret != null && !clientSecret.isBlank();
        }
    }

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String, String>> handleApiException(ApiException exception) {
        return ResponseEntity.status(exception.status()).body(Map.of("error", exception.getMessage()));
    }

    private static class ApiException extends RuntimeException {
        private final HttpStatus status;
        ApiException(HttpStatus status, String message) { super(message); this.status = status; }
        HttpStatus status() { return status; }
    }
}
