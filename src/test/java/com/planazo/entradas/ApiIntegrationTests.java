package com.planazo.entradas;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:planazo-tests;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
    "app.auth.jwt-secret=VGhpcy1pcy1hLWRldi1zZWNyZXQta2V5LWZvci1sb2NhbC1kZXZlbG9wbWVudC1vbmx5",
    "logging.level.root=WARN"
})
@AutoConfigureMockMvc
class ApiIntegrationTests {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper mapper;

    @Test
    void healthStatsAndWebAreAvailable() throws Exception {
        JsonNode health = json(mvc.perform(get("/api/health")).andExpect(status().isOk()).andReturn());
        assertEquals("ok", health.get("status").asText());
        assertEquals("spring-boot", health.get("runtime").asText());

        JsonNode stats = json(mvc.perform(get("/api/stats")).andExpect(status().isOk()).andReturn());
        assertEquals(12, stats.get("events").asInt());
        assertEquals(3, stats.get("cities").asInt());

        String html = mvc.perform(get("/index.html")).andExpect(status().isOk()).andReturn()
            .getResponse().getContentAsString();
        assertTrue(html.contains("Planazo"));
        assertTrue(html.contains("/app.js"));
        mvc.perform(get("/styles.css")).andExpect(status().isOk());
        mvc.perform(get("/app.js")).andExpect(status().isOk());
    }

    @Test
    void eventsCanBeFilteredAndSorted() throws Exception {
        JsonNode byPrice = json(mvc.perform(get("/api/events")
            .param("sort", "price-asc")).andExpect(status().isOk()).andReturn());
        assertEquals(12, byPrice.get("data").size());
        assertEquals(7, byPrice.get("data").get(0).get("price").asInt());

        JsonNode filtered = json(mvc.perform(get("/api/events")
            .param("type", "Cine").param("city", "Madrid")
            .param("search", "otono").param("sort", "title"))
            .andExpect(status().isOk()).andReturn());
        assertEquals(1, filtered.get("total").asInt());
        assertEquals("Estrenos de otoño", filtered.get("data").get(0).get("title").asText());

        JsonNode featured = json(mvc.perform(get("/api/events/featured"))
            .andExpect(status().isOk()).andReturn());
        assertEquals(4, featured.get("data").size());
    }

    @Test
    void clientCanRegisterSaveFavoritesAndBook() throws Exception {
        String email = "test-cliente-" + UUID.randomUUID() + "@ejemplo.com";
        JsonNode registered = json(mvc.perform(post("/api/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"password\":\"ClaveSegura2026\"}"))
            .andExpect(status().isCreated()).andReturn());
        String token = registered.get("token").asText();
        assertEquals("CLIENTE", registered.get("user").get("role").asText());
        assertFalse(registered.get("refreshToken").asText().isBlank());

        mvc.perform(post("/api/favorites/1").header("Authorization", "Bearer " + token))
            .andExpect(status().isCreated());
        JsonNode favorites = json(mvc.perform(get("/api/favorites")
            .header("Authorization", "Bearer " + token)).andExpect(status().isOk()).andReturn());
        assertEquals(1, favorites.get(0).asInt());

        JsonNode booking = json(mvc.perform(post("/api/bookings")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"eventId\":1,\"quantity\":2}"))
            .andExpect(status().isCreated()).andReturn());
        long bookingId = booking.get("data").get("id").asLong();

        JsonNode mine = json(mvc.perform(get("/api/bookings/me")
            .header("Authorization", "Bearer " + token)).andExpect(status().isOk()).andReturn());
        assertEquals(1, mine.size());
        assertEquals(2, mine.get(0).get("quantity").asInt());

        mvc.perform(delete("/api/bookings/" + bookingId)
            .header("Authorization", "Bearer " + token)).andExpect(status().isNoContent());
        mvc.perform(delete("/api/favorites/1")
            .header("Authorization", "Bearer " + token)).andExpect(status().isNoContent());
    }

    @Test
    void onlyManagersCanEditEventsAndOnlyAdminCanChangeRoles() throws Exception {
        String cliente = "test-cliente-" + UUID.randomUUID() + "@ejemplo.com";
        JsonNode clientSession = json(mvc.perform(post("/api/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + cliente + "\",\"password\":\"ClaveSegura2026\"}"))
            .andExpect(status().isCreated()).andReturn());
        String clientToken = clientSession.get("token").asText();

        String event = """
            {"type":"Cine","title":"Prueba de integración","venue":"Sala 1","city":"Madrid",
             "date":"2026-12-31","time":"20:00","price":15,"image":"cinema",
             "accent":"#7dd3fc","featured":false}
            """;
        mvc.perform(post("/api/events").header("Authorization", "Bearer " + clientToken)
            .contentType(MediaType.APPLICATION_JSON).content(event)).andExpect(status().isForbidden());

        JsonNode adminSession = json(mvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"admin@planazo.local\",\"password\":\"AdminPlanazo2026!\"}"))
            .andExpect(status().isOk()).andReturn());
        String adminToken = adminSession.get("token").asText();

        JsonNode created = json(mvc.perform(post("/api/events")
                .header("Authorization", "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON).content(event))
            .andExpect(status().isCreated()).andReturn());
        long id = created.get("data").get("id").asLong();

        JsonNode updated = json(mvc.perform(put("/api/events/" + id)
                .header("Authorization", "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(event.replace("Prueba de integración", "Prueba editada")))
            .andExpect(status().isOk()).andReturn());
        assertEquals("Prueba editada", updated.get("data").get("title").asText());

        long clientId = clientSession.get("user").get("id").asLong();
        mvc.perform(patch("/api/auth/users/" + clientId + "/role")
                .header("Authorization", "Bearer " + clientToken)
                .param("role", "GESTO")).andExpect(status().isForbidden());

        JsonNode users = json(mvc.perform(get("/api/auth/users")
            .header("Authorization", "Bearer " + adminToken)).andExpect(status().isOk()).andReturn());
        assertTrue(users.get("total").asInt() >= 4);

        mvc.perform(delete("/api/events/" + id)
            .header("Authorization", "Bearer " + adminToken)).andExpect(status().isNoContent());
    }

    @Test
    void refreshTokenIsRotatedAndLogoutRevokesIt() throws Exception {
        JsonNode login = json(mvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"cliente@planazo.local\",\"password\":\"ClientePlanazo2026!\"}"))
            .andExpect(status().isOk()).andReturn());
        String refresh = login.get("refreshToken").asText();

        JsonNode renewed = json(mvc.perform(post("/api/auth/refresh")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"refreshToken\":\"" + refresh + "\"}"))
            .andExpect(status().isOk()).andReturn());
        assertFalse(renewed.get("token").asText().isBlank());

        mvc.perform(post("/api/auth/refresh")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"refreshToken\":\"" + refresh + "\"}"))
            .andExpect(status().isUnauthorized());

        mvc.perform(post("/api/auth/logout")
                .header("Authorization", "Bearer " + renewed.get("token").asText())
                .param("refreshToken", renewed.get("refreshToken").asText()))
            .andExpect(status().isOk());
        mvc.perform(get("/api/auth/me")
                .header("Authorization", "Bearer " + renewed.get("token").asText()))
            .andExpect(status().isUnauthorized());
    }

    private JsonNode json(MvcResult result) throws Exception {
        return mapper.readTree(result.getResponse().getContentAsString());
    }
}
