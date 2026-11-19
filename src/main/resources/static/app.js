/* ============================================================
   Planazo · lógica de la web servida por Spring Boot
   ============================================================ */
"use strict";

const TOKEN_KEY = "planazo_token";
const REFRESH_KEY = "planazo_refresh_token";
const USER_KEY = "planazo_user";
const THEME_KEY = "planazo_theme";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const MONTHS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
const VISUAL = { concert: "LIVE", theatre: "EN ESCENA", cinema: "BUEN CINE" };
const DESCRIPTION = {
  Concierto: "Vive la música en directo: luces, sonido y esa energía que no se olvida. Un plan para sentirlo desde la primera nota.",
  Teatro: "Historias que cobran vida encima de un escenario. Déjate llevar por la actuación y descubre algo nuevo.",
  Cine: "La pantalla grande, el sonido envolvente y una historia que merece verse como se debe. Tu plan perfecto para desconectar.",
};

let session = readSession();
const state = {
  events: [],
  allEvents: [],
  favorites: [],
  bookings: [],
  selectedEvent: null,
  adminTab: "events",
  filters: { search: "", type: "Todos", city: "Todas", sort: "date", featured: false },
};

/* ---------------- Utilidades ---------------- */
function readSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  const raw = localStorage.getItem(USER_KEY);
  if (!token || !raw) return null;
  try {
    return { token, user: JSON.parse(raw) };
  } catch {
    return null;
  }
}

function saveSession(payload) {
  if (payload?.token) localStorage.setItem(TOKEN_KEY, payload.token);
  if (payload?.refreshToken) localStorage.setItem(REFRESH_KEY, payload.refreshToken);
  if (payload?.user) localStorage.setItem(USER_KEY, JSON.stringify(payload.user));
  session = readSession();
  renderSession();
}

function clearSession() {
  [TOKEN_KEY, REFRESH_KEY, USER_KEY].forEach((key) => localStorage.removeItem(key));
  session = null;
  state.favorites = [];
  state.bookings = [];
  renderSession();
  renderFavorites();
  renderBookings();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function toast(message, type = "") {
  const element = document.createElement("div");
  element.className = `toast ${type}`;
  element.textContent = message;
  $("#toast-region").append(element);
  setTimeout(() => {
    element.classList.add("out");
    setTimeout(() => element.remove(), 260);
  }, 3600);
}

function dateParts(iso) {
  const [year, month, day] = String(iso || "").split("-");
  const shortMonth = MONTHS[Number(month) - 1] || "";
  return {
    day: day || "–",
    month: shortMonth,
    year: year || "",
    full: `${day || "–"} ${shortMonth} ${year}`.trim(),
  };
}

function roleClass(role) {
  return role === "ADMIN" ? "admin" : role === "GESTOR" ? "gestor" : "";
}

/* ---------------- API con refresco automático ---------------- */
async function api(path, options = {}, retry = true) {
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (response.status === 401 && retry && localStorage.getItem(REFRESH_KEY) && !path.includes("/auth/refresh")) {
    try {
      const refreshed = await api("/api/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken: localStorage.getItem(REFRESH_KEY) }),
      }, false);
      saveSession(refreshed);
      return api(path, options, false);
    } catch {
      clearSession();
      throw new Error("Tu sesión ha caducado. Vuelve a iniciar sesión.");
    }
  }

  let body = null;
  if (response.status !== 204) {
    const text = await response.text();
    if (text) {
      try { body = JSON.parse(text); } catch { body = { error: text }; }
    }
  }
  if (!response.ok) {
    throw new Error(body?.error || body?.detail || "No se pudo completar la operación");
  }
  return body;
}

/* ---------------- Sesión y cabecera ---------------- */
function renderSession() {
  const area = $("#session-area");
  if (session) {
    const user = session.user || { email: "@", role: "CLIENTE" };
    area.innerHTML = `
      <div class="session-chip">
        <span class="session-avatar">${escapeHtml(String(user.email)[0] || "?").toUpperCase()}</span>
        <span class="session-email" title="${escapeHtml(user.email)}">${escapeHtml(user.email)}</span>
        <span class="role-tag ${roleClass(user.role)}">${escapeHtml(user.role)}</span>
        <button class="logout-button" id="logout" title="Cerrar sesión" aria-label="Cerrar sesión">↪</button>
      </div>`;
    $("#logout").addEventListener("click", logout);
  } else {
    area.innerHTML = '<button class="btn btn-primary btn-sm" id="open-auth" type="button">Iniciar sesión</button>';
    $("#open-auth").addEventListener("click", () => openAuth());
  }

  const isAdmin = !!session && session.user?.role === "ADMIN";
  const isManager = isAdmin || (!!session && session.user?.role === "GESTOR");
  ["#nav-favorites", "#mobile-favorites"].forEach((selector) => { $(selector).hidden = !session; });
  ["#nav-bookings", "#mobile-bookings"].forEach((selector) => { $(selector).hidden = !session; });
  ["#nav-admin", "#mobile-admin"].forEach((selector) => { $(selector).hidden = !isManager; });
  $("#admin").hidden = !isManager;
  $("#tab-users").hidden = !isAdmin;
  $("#fav-count").textContent = state.favorites.length;
}

function handleHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has("oauth_error")) {
    toast(decodeURIComponent(params.get("oauth_error")), "error");
    history.replaceState(null, "", location.pathname + location.search);
    return;
  }
  if (params.has("oauth_token") && params.has("oauth_refresh_token")) {
    saveSession({ token: params.get("oauth_token"), refreshToken: params.get("oauth_refresh_token") });
    history.replaceState(null, "", location.pathname + location.search);
    api("/api/auth/me")
      .then((data) => {
        saveSession(data);
        toast("Sesión iniciada correctamente", "success");
        loadPrivateData();
      })
      .catch(() => clearSession());
  }
}

async function logout() {
  const refresh = localStorage.getItem(REFRESH_KEY) || "";
  try {
    await api(`/api/auth/logout?refreshToken=${encodeURIComponent(refresh)}`, { method: "POST" });
  } catch {
    /* se cierra la sesión local de todas formas */
  }
  clearSession();
  toast("Sesión cerrada", "success");
}

/* ---------------- Eventos ---------------- */
async function loadStats() {
  try {
    const stats = await api("/api/stats");
    $("#stat-events").textContent = stats.events;
    $("#stat-cities").textContent = stats.cities;
    $("#stat-bookings").textContent = stats.bookings;
  } catch {
    /* las estadísticas son decorativas */
  }
}

async function loadEvents() {
  const grid = $("#event-grid");
  grid.innerHTML = '<div class="skeleton"></div>'.repeat(3);
  const { search, type, city, sort } = state.filters;
  const params = new URLSearchParams({ search, type, city, sort });
  try {
    const result = await api(`/api/events?${params}`);
    state.events = result.data;
    renderEvents();
  } catch (error) {
    grid.innerHTML = `<p class="state error">${escapeHtml(error.message)}</p>`;
  }
}

async function loadAllEvents() {
  try {
    state.allEvents = (await api("/api/events?sort=date")).data;
  } catch {
    state.allEvents = state.events;
  }
  renderFavorites();
}

function eventCardHtml(event) {
  const date = dateParts(event.date);
  const favorite = state.favorites.includes(event.id);
  return `
    <article class="event-card" data-id="${event.id}">
      <div class="event-visual ${escapeHtml(event.image)}" style="--accent:${escapeHtml(event.accent)}">
        ${event.featured ? '<span class="featured-star" title="Destacado">★</span>' : ""}
        <span>${escapeHtml(event.type)}</span>
        <strong>${VISUAL[event.image] || "PLANAZO"}</strong>
        <div class="date-badge"><b>${escapeHtml(date.day)}</b><small>${escapeHtml(date.month)}</small></div>
        <button class="fav-button ${favorite ? "active" : ""}" data-fav="${event.id}"
          aria-label="${favorite ? "Quitar de favoritos" : "Añadir a favoritos"}" title="Favoritos">${favorite ? "♥" : "♡"}</button>
      </div>
      <div class="event-body">
        <h3>${escapeHtml(event.title)}</h3>
        <p class="event-meta">${escapeHtml(date.full)} · ${escapeHtml(event.time)}</p>
        <p class="event-meta">${escapeHtml(event.venue)} · ${escapeHtml(event.city)}</p>
        <div class="event-footer">
          <span class="event-price">${event.price}€ <small>desde</small></span>
          <div class="event-actions">
            <button class="icon-button" data-detail="${event.id}" aria-label="Ver detalle" title="Ver detalle">◎</button>
            <button class="btn btn-primary" data-book="${event.id}" type="button">Reservar</button>
          </div>
        </div>
      </div>
    </article>`;
}

function renderEvents() {
  const visible = state.events.filter((event) => !state.filters.featured || event.featured);
  $("#result-count").textContent = `${visible.length} ${visible.length === 1 ? "plan" : "planes"}`;

  const chips = [];
  if (state.filters.search) chips.push(`“${escapeHtml(state.filters.search)}”`);
  if (state.filters.type !== "Todos") chips.push(escapeHtml(state.filters.type));
  if (state.filters.city !== "Todas") chips.push(escapeHtml(state.filters.city));
  if (state.filters.featured) chips.push("Destacados");
  $("#active-filters").innerHTML = chips.length ? `Filtros activos: <b>${chips.join(" · ")}</b>` : "";

  $("#event-grid").innerHTML = visible.length
    ? visible.map(eventCardHtml).join("")
    : '<p class="state">No hemos encontrado planes con esos filtros. Prueba con otros criterios.</p>';
}

function findEvent(id) {
  return state.allEvents.find((event) => event.id === id) || state.events.find((event) => event.id === id);
}

function syncFilters() {
  state.filters.search = $("#search").value.trim();
  state.filters.type = $("#type").value;
  state.filters.city = $("#city").value;
  state.filters.sort = $("#sort").value;
  state.filters.featured = $("#only-featured").checked;
}

/* ---------------- Favoritos ---------------- */
async function loadFavorites() {
  if (!session) {
    state.favorites = [];
    renderFavorites();
    renderEvents();
    return;
  }
  try {
    state.favorites = await api("/api/favorites");
  } catch {
    state.favorites = [];
  }
  $("#fav-count").textContent = state.favorites.length;
  await loadAllEvents();
  renderEvents();
}

function renderFavorites() {
  $("#favoritos").hidden = !session || state.favorites.length === 0;
  $("#favorites-count").textContent = `${state.favorites.length} ${state.favorites.length === 1 ? "guardado" : "guardados"}`;
  const events = state.allEvents.filter((event) => state.favorites.includes(event.id));
  $("#favorites-grid").innerHTML = events.length
    ? events.map((event) => `
        <article class="mini-card">
          <div class="mini-thumb" style="--accent:${escapeHtml(event.accent)}">✦</div>
          <div><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.city)} · ${event.price}€</small></div>
          <button data-fav-mini="${event.id}" aria-label="Quitar de favoritos" title="Quitar">×</button>
        </article>`).join("")
    : '<p class="state">Aún no has guardado ningún plan. Pulsa ♡ en cualquier evento.</p>';
}

async function toggleFavorite(id) {
  if (!session) {
    toast("Inicia sesión para guardar favoritos");
    openAuth();
    return;
  }
  const exists = state.favorites.includes(id);
  try {
    await api(`/api/favorites/${id}`, { method: exists ? "DELETE" : "POST" });
    state.favorites = exists ? state.favorites.filter((item) => item !== id) : [id, ...state.favorites];
    $("#fav-count").textContent = state.favorites.length;
    renderEvents();
    renderFavorites();
    toast(exists ? "Eliminado de favoritos" : "Añadido a favoritos", "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

/* ---------------- Reservas ---------------- */
async function loadBookings() {
  if (!session) {
    state.bookings = [];
    renderBookings();
    return;
  }
  try {
    state.bookings = await api("/api/bookings/me");
  } catch {
    state.bookings = [];
  }
  renderBookings();
}

function renderBookings() {
  $("#reservas").hidden = !session;
  $("#bookings-count").textContent = `${state.bookings.length} ${state.bookings.length === 1 ? "reserva" : "reservas"}`;
  $("#bookings-list").innerHTML = state.bookings.length
    ? state.bookings.map((booking) => `
        <article class="booking-item">
          <div><h3>${escapeHtml(booking.title)}</h3>
            <p>${escapeHtml(booking.venue)} · ${escapeHtml(booking.eventDate)} · ${escapeHtml(booking.eventTime)}</p></div>
          <span class="qty">${booking.quantity} ${booking.quantity === 1 ? "entrada" : "entradas"}</span>
          <span class="total">${booking.price * booking.quantity}€</span>
          <button class="cancel" data-cancel="${booking.id}">Cancelar</button>
        </article>`).join("")
    : '<p class="state">Todavía no tienes reservas. ¡Elige tu primer planazo!</p>';
}

async function cancelBooking(id) {
  if (!confirm("¿Cancelar esta reserva?")) return;
  try {
    await api(`/api/bookings/${id}`, { method: "DELETE" });
    state.bookings = state.bookings.filter((booking) => booking.id !== id);
    renderBookings();
    await loadStats();
    toast("Reserva cancelada", "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

/* ---------------- Diálogo de autenticación ---------------- */
function openAuth(mode = "login") {
  setAuthMode(mode);
  $("#auth-message").textContent = "";
  $("#auth-message").classList.remove("success");
  if (!$("#auth-dialog").open) $("#auth-dialog").showModal();
}

function setAuthMode(mode) {
  const register = mode === "register";
  $("#auth-dialog").dataset.mode = mode;
  $("#auth-title").textContent = register ? "Crea tu cuenta." : "Vuelve a tus planes.";
  $("#auth-submit").innerHTML = register ? 'Registrarme <span>↗</span>' : 'Entrar <span>↗</span>';
  $("#auth-toggle").textContent = register ? "Ya tengo una cuenta" : "¿No tienes cuenta? Regístrate";
}

/* ---------------- Detalle y reserva ---------------- */
function openEvent(id) {
  const event = findEvent(id);
  if (!event) return;
  const date = dateParts(event.date);
  const favorite = state.favorites.includes(event.id);
  $("#event-detail").innerHTML = `
    <div class="event-detail-visual ${escapeHtml(event.image)}"
      style="background:linear-gradient(135deg, ${escapeHtml(event.accent)}, #8b5cf6)">
      <span>${VISUAL[event.image] || "PLANAZO"}</span>
    </div>
    <p class="eyebrow">${escapeHtml(event.type)} · ${escapeHtml(event.city)}</p>
    <h2>${escapeHtml(event.title)}</h2>
    <p class="event-detail-meta">📅 ${escapeHtml(date.full)} · ${escapeHtml(event.time)}</p>
    <p class="event-detail-meta">📍 ${escapeHtml(event.venue)}</p>
    <p class="event-detail-desc">${DESCRIPTION[event.type] || "Una experiencia que merece vivirse en directo."}</p>
    <div class="event-detail-footer">
      <span class="event-price">${event.price}€ <small>desde</small></span>
      <div class="event-actions">
        <button class="fav-button ${favorite ? "active" : ""}" data-fav-detail="${event.id}"
          aria-label="Favorito" title="Favorito">${favorite ? "♥" : "♡"}</button>
        <button class="btn btn-primary" data-book-detail="${event.id}">Reservar entradas ↗</button>
      </div>
    </div>`;
  $("#event-dialog").showModal();
}

function openBooking(id) {
  if (!session) {
    toast("Inicia sesión para reservar entradas");
    openAuth();
    return;
  }
  const event = findEvent(id);
  if (!event) return;
  state.selectedEvent = event;
  $("#booking-title").textContent = event.title;
  $("#booking-subtitle").textContent = `${event.venue} · ${event.city} · ${dateParts(event.date).full}`;
  $("#booking-quantity").value = "2";
  updateBookingPrice();
  $("#booking-dialog").showModal();
}

function updateBookingPrice() {
  const quantity = Number($("#booking-quantity").value);
  const price = state.selectedEvent?.price || 0;
  $("#booking-unit").textContent = `${price}€`;
  $("#booking-total").textContent = `${price * quantity}€`;
}

/* ---------------- Administración ---------------- */
async function loadAdmin() {
  if (!session || !["ADMIN", "GESTOR"].includes(session.user?.role)) return;
  try {
    const result = await api("/api/events?sort=date");
    $("#admin-events-body").innerHTML = result.data.map((event) => `
      <tr>
        <td><strong>${escapeHtml(event.title)}</strong></td>
        <td>${escapeHtml(event.type)}</td>
        <td>${escapeHtml(event.city)}</td>
        <td>${escapeHtml(event.date)}</td>
        <td>${event.price}€</td>
        <td><div class="row-actions">
          <button data-edit="${event.id}" type="button">Editar</button>
          <button data-delete="${event.id}" type="button">Eliminar</button>
        </div></td>
      </tr>`).join("");
  } catch (error) {
    toast(error.message, "error");
  }

  if (session.user?.role === "ADMIN") {
    try {
      const result = await api("/api/auth/users");
      $("#admin-users-body").innerHTML = result.data.map((user) => `
        <tr>
          <td>${user.id}</td>
          <td>${escapeHtml(user.email)}</td>
          <td><select data-role-user="${user.id}" aria-label="Rol de ${escapeHtml(user.email)}">
            ${["CLIENTE", "GESTOR", "ADMIN"].map((role) => `<option ${role === user.role ? "selected" : ""}>${role}</option>`).join("")}
          </select></td>
          <td>${escapeHtml(String(user.createdAt).slice(0, 10))}</td>
        </tr>`).join("");
    } catch (error) {
      toast(error.message, "error");
    }
  }
}

function openEditor(event) {
  const form = $("#editor-form");
  const field = (name) => form.elements.namedItem(name);
  form.reset();
  $("#editor-id").value = event?.id || "";
  $("#editor-title").textContent = event ? "Editar evento" : "Nuevo evento";
  if (event) {
    field("title").value = event.title;
    field("type").value = event.type;
    field("city").value = event.city;
    field("venue").value = event.venue;
    field("date").value = event.date;
    field("time").value = event.time;
    field("price").value = event.price;
    field("image").value = event.image;
    field("accent").value = /^#[0-9a-f]{6}$/i.test(event.accent) ? event.accent : "#ffb86b";
    field("featured").checked = !!event.featured;
  }
  $("#editor-dialog").showModal();
}

async function loadPrivateData() {
  await Promise.all([loadFavorites(), loadBookings(), loadAdmin()]);
}

/* ---------------- Eventos de la interfaz ---------------- */
$("#event-grid").addEventListener("click", (event) => {
  if (event.target.closest("[data-fav]")) {
    toggleFavorite(Number(event.target.closest("[data-fav]").dataset.fav));
  } else if (event.target.closest("[data-detail]")) {
    openEvent(Number(event.target.closest("[data-detail]").dataset.detail));
  } else if (event.target.closest("[data-book]")) {
    openBooking(Number(event.target.closest("[data-book]").dataset.book));
  }
});

$("#favorites-grid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-fav-mini]");
  if (button) toggleFavorite(Number(button.dataset.favMini));
});

$("#bookings-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-cancel]");
  if (button) cancelBooking(Number(button.dataset.cancel));
});

$("#event-dialog").addEventListener("click", (event) => {
  if (event.target.closest("[data-fav-detail]")) {
    toggleFavorite(Number(event.target.closest("[data-fav-detail]").dataset.favDetail));
    $("#event-dialog").close();
  } else if (event.target.closest("[data-book-detail]")) {
    const id = Number(event.target.closest("[data-book-detail]").dataset.bookDetail);
    $("#event-dialog").close();
    openBooking(id);
  }
});

let searchTimer;
$("#search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.filters.search = $("#search").value.trim();
    loadEvents();
  }, 320);
});

$("#filters").addEventListener("submit", (event) => {
  event.preventDefault();
  syncFilters();
  loadEvents();
});

["#type", "#city", "#sort", "#only-featured"].forEach((selector) => {
  $(selector).addEventListener("change", () => {
    syncFilters();
    loadEvents();
  });
});

$("#clear-filters").addEventListener("click", () => {
  $("#search").value = "";
  $("#type").value = "Todos";
  $("#city").value = "Todas";
  $("#sort").value = "date";
  $("#only-featured").checked = false;
  syncFilters();
  loadEvents();
});

$("#fav-shortcut").addEventListener("click", () => {
  if (!session) {
    toast("Inicia sesión para ver tus favoritos");
    openAuth();
    return;
  }
  $("#favoritos").scrollIntoView({ behavior: "smooth" });
});

$("#hero-github").addEventListener("click", () => { location.href = "/api/auth/oauth/github"; });

$("#auth-toggle").addEventListener("click", () => {
  setAuthMode($("#auth-dialog").dataset.mode === "register" ? "login" : "register");
  $("#auth-message").textContent = "";
});

$("#toggle-password").addEventListener("click", () => {
  const input = $("#auth-form input[name='password']");
  input.type = input.type === "password" ? "text" : "password";
});

$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const mode = $("#auth-dialog").dataset.mode || "login";
  const form = event.currentTarget;
  const message = $("#auth-message");
  message.classList.remove("success");
  message.textContent = "Un momento...";
  try {
    const result = await api(`/api/auth/${mode}`, {
      method: "POST",
      body: JSON.stringify({
        email: form.elements.namedItem("email").value.trim(),
        password: form.elements.namedItem("password").value,
      }),
    });
    saveSession(result);
    form.reset();
    message.classList.add("success");
    message.textContent = mode === "register" ? "¡Cuenta creada! Ya estás dentro." : `¡Hola de nuevo, ${result.user.email}!`;
    await loadPrivateData();
    setTimeout(() => {
      $("#auth-dialog").close();
      toast("Sesión iniciada", "success");
    }, 700);
  } catch (error) {
    message.textContent = error.message;
  }
});

$("#booking-quantity").addEventListener("change", updateBookingPrice);

$("#booking-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.selectedEvent) return;
  try {
    const result = await api("/api/bookings", {
      method: "POST",
      body: JSON.stringify({
        eventId: state.selectedEvent.id,
        quantity: Number($("#booking-quantity").value),
      }),
    });
    $("#booking-dialog").close();
    toast(result.message || "Reserva confirmada", "success");
    await Promise.all([loadBookings(), loadStats()]);
  } catch (error) {
    toast(error.message, "error");
  }
});

$("#new-event").addEventListener("click", () => openEditor());

$("#editor-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const field = (name) => event.currentTarget.elements.namedItem(name);
  const id = $("#editor-id").value;
  const payload = {
    title: field("title").value.trim(),
    type: field("type").value,
    city: field("city").value,
    venue: field("venue").value.trim(),
    date: field("date").value,
    time: field("time").value,
    price: Number(field("price").value),
    image: field("image").value,
    accent: field("accent").value,
    featured: field("featured").checked,
  };
  try {
    await api(id ? `/api/events/${id}` : "/api/events", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    $("#editor-dialog").close();
    toast(id ? "Evento actualizado" : "Evento creado", "success");
    await Promise.all([loadEvents(), loadAllEvents(), loadAdmin(), loadStats()]);
  } catch (error) {
    toast(error.message, "error");
  }
});

$("#admin-events-body").addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-edit]");
  if (edit) {
    try {
      openEditor((await api(`/api/events/${edit.dataset.edit}`)).data);
    } catch (error) {
      toast(error.message, "error");
    }
    return;
  }
  const remove = event.target.closest("[data-delete]");
  if (remove && confirm("¿Eliminar este evento del catálogo?")) {
    try {
      await api(`/api/events/${remove.dataset.delete}`, { method: "DELETE" });
      toast("Evento eliminado", "success");
      await Promise.all([loadEvents(), loadAllEvents(), loadAdmin(), loadStats()]);
    } catch (error) {
      toast(error.message, "error");
    }
  }
});

$("#admin-users-body").addEventListener("change", async (event) => {
  const select = event.target.closest("[data-role-user]");
  if (!select) return;
  try {
    await api(`/api/auth/users/${select.dataset.roleUser}/role?role=${select.value}`, { method: "PATCH" });
    toast("Rol actualizado", "success");
    if (session.user.id === Number(select.dataset.roleUser)) {
      session.user.role = select.value;
      localStorage.setItem(USER_KEY, JSON.stringify(session.user));
      renderSession();
    }
  } catch (error) {
    toast(error.message, "error");
    await loadAdmin();
  }
});

$$(".admin-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".admin-tab").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    state.adminTab = tab.dataset.tab;
    $("#admin-events").hidden = state.adminTab !== "events";
    $("#admin-users").hidden = state.adminTab !== "users";
  });
});

$("#newsletter-form").addEventListener("submit", (event) => {
  event.preventDefault();
  toast("¡Listo! Te avisaremos del próximo planazo.", "success");
  event.currentTarget.reset();
});

/* Tema, menú móvil, diálogos y scroll */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("#theme-toggle").textContent = theme === "dark" ? "☀" : "◐";
}

applyTheme(localStorage.getItem(THEME_KEY) || "light");
$("#theme-toggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

$("#menu-button").addEventListener("click", () => {
  const open = $("#mobile-nav").classList.toggle("open");
  $("#menu-button").setAttribute("aria-expanded", String(open));
});
$$("#mobile-nav a").forEach((link) => link.addEventListener("click", () => {
  $("#mobile-nav").classList.remove("open");
  $("#menu-button").setAttribute("aria-expanded", "false");
}));

$$("[data-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
$$("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
}));

window.addEventListener("scroll", () => {
  const documentElement = document.documentElement;
  const max = documentElement.scrollHeight - window.innerHeight;
  $("#scroll-progress").style.width = `${max > 0 ? (window.scrollY / max) * 100 : 0}%`;
  $("#back-to-top").classList.toggle("visible", window.scrollY > 500);
}, { passive: true });

$("#back-to-top").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

/* ---------------- Arranque ---------------- */
async function init() {
  handleHash();
  renderSession();
  await loadEvents();
  await loadStats();
  if (session && !session.user) {
    try {
      const data = await api("/api/auth/me");
      saveSession(data);
    } catch {
      clearSession();
    }
  }
  if (session) await loadPrivateData();
  else await loadAllEvents();
}

init();
