import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const types = ["Todos", "Concierto", "Teatro", "Cine"];
const cities = ["Todas", "Madrid", "Barcelona", "Valencia"];
const tokenKey = "planazo_token";
const refreshKey = "planazo_refresh_token";
const userKey = "planazo_user";
const sessionEvent = "planazo:session";

function notifySession() {
  window.dispatchEvent(new Event(sessionEvent));
}

function saveSession(session) {
  if (session.token) localStorage.setItem(tokenKey, session.token);
  if (session.refreshToken) localStorage.setItem(refreshKey, session.refreshToken);
  if (session.user) localStorage.setItem(userKey, JSON.stringify(session.user));
  notifySession();
}

function clearSession() {
  [tokenKey, refreshKey, userKey].forEach((key) => localStorage.removeItem(key));
  notifySession();
}

function readSession() {
  const token = localStorage.getItem(tokenKey);
  const rawUser = localStorage.getItem(userKey);
  if (!token || !rawUser) return null;
  try {
    return { token, user: JSON.parse(rawUser) };
  } catch {
    return null;
  }
}

async function api(path, options = {}, retry = true) {
  const token = localStorage.getItem(tokenKey);
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (response.status === 401 && retry && localStorage.getItem(refreshKey) && !path.includes("/auth/refresh")) {
    try {
      const refreshed = await api("/api/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken: localStorage.getItem(refreshKey) }),
      }, false);
      saveSession(refreshed);
      return api(path, options, false);
    } catch {
      clearSession();
    }
  }

  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || body?.detail || "No se pudo completar la operación");
  return body;
}

function EventCard({ event, onBook }) {
  return <article className="event-card">
    <div className="event-visual" style={{ "--accent": event.accent }}>
      <span>{event.type}</span>
      <strong>{event.image === "concert" ? "LIVE" : event.image === "theatre" ? "EN ESCENA" : "BUEN CINE"}</strong>
    </div>
    <div className="event-body">
      <h3>{event.title}</h3>
      <p>{event.date} · {event.time}</p>
      <p>{event.venue} · {event.city}</p>
      <b>desde {event.price}€</b>
      <button onClick={() => onBook(event)}>Alquilar entradas ↗</button>
    </div>
  </article>;
}

function App() {
  const [events, setEvents] = useState([]);
  const [filters, setFilters] = useState({ search: "", type: "Todos", city: "Todas" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [session, setSession] = useState(readSession);
  const [mode, setMode] = useState("login");
  const [auth, setAuth] = useState({ email: "", password: "" });
  const [message, setMessage] = useState("");
  const [bookings, setBookings] = useState([]);

  useEffect(() => {
    const sync = () => setSession(readSession());
    window.addEventListener(sessionEvent, sync);
    return () => window.removeEventListener(sessionEvent, sync);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (!params.has("oauth_token") || !params.has("oauth_refresh_token")) return;
    saveSession({ token: params.get("oauth_token"), refreshToken: params.get("oauth_refresh_token") });
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setMessage("Sesión iniciada con GitHub");
    api("/api/auth/me")
      .then((data) => saveSession({ user: data.user }))
      .catch(() => clearSession());
  }, []);

  async function loadEvents(next = filters) {
    setLoading(true); setError("");
    try {
      const payload = await api(`/api/events?${new URLSearchParams(next)}`);
      setEvents(payload.data);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadEvents(); }, []);

  useEffect(() => {
    if (!session) { setBookings([]); return; }
    api("/api/bookings/me").then(setBookings).catch(() => {});
  }, [session?.token]);

  async function submitAuth(event) {
    event.preventDefault();
    setMessage("");
    try {
      const payload = await api(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(auth),
      });
      saveSession(payload);
      setMessage(mode === "register" ? "Cuenta creada y sesión iniciada" : `Hola de nuevo, ${payload.user.email}`);
      setAuth({ email: "", password: "" });
    } catch (cause) {
      setMessage(cause.message);
    }
  }

  async function logout() {
    const refreshToken = localStorage.getItem(refreshKey) || "";
    try {
      await api(`/api/auth/logout?refreshToken=${encodeURIComponent(refreshToken)}`, { method: "POST" });
    } catch {
      /* la sesión local se cierra de todas formas */
    }
    clearSession();
    setMessage("Sesión cerrada");
    setBookings([]);
  }

  async function book(item) {
    if (!session) {
      setMessage("Inicia sesión para reservar entradas");
      document.getElementById("login")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    const quantity = Number(window.prompt(`¿Cuántas entradas para "${item.title}"?`, "2"));
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) return;
    try {
      const payload = await api("/api/bookings", {
        method: "POST",
        body: JSON.stringify({ eventId: item.id, quantity }),
      });
      setMessage(payload.message);
      setBookings(await api("/api/bookings/me"));
    } catch (cause) {
      setMessage(cause.message);
    }
  }

  return <>
    <header>
      <a className="brand" href="/">✦ planazo</a>
      <nav>
        <a href="#explorar">Explorar</a>
        {session && <a href="#reservas">Mis reservas</a>}
      </nav>
      <div className="header-actions">
        {session ? <>
          <span className="session-label" title={session.user.role}>{session.user.email}</span>
          <button className="ghost-button" onClick={logout}>Cerrar sesión</button>
        </> : <a className="ghost-button" href="#login">Iniciar sesión</a>}
      </div>
    </header>

    <main>
      <section className="hero">
        <p className="eyebrow">Vive el momento</p>
        <h1>Encuentra tu próximo <em>planazo.</em></h1>
        <p>Menos pantalla. Más momentos.</p>
      </section>

      <section id="explorar">
        <p className="eyebrow">Descubre tu próximo plan</p>
        <h2>Todo lo que te apetece, en un solo lugar.</h2>
        <form className="filters" onSubmit={(event) => { event.preventDefault(); loadEvents(); }}>
          <input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Artista, evento o lugar" />
          <select value={filters.type} onChange={(event) => { const next = { ...filters, type: event.target.value }; setFilters(next); loadEvents(next); }}>
            {types.map((value) => <option key={value}>{value}</option>)}
          </select>
          <select value={filters.city} onChange={(event) => { const next = { ...filters, city: event.target.value }; setFilters(next); loadEvents(next); }}>
            {cities.map((value) => <option key={value}>{value}</option>)}
          </select>
          <button type="submit">Buscar planes ↗</button>
        </form>
        {loading ? <p className="state">Buscando tus próximos planes...</p>
          : error ? <p className="state error">{error}</p>
          : !events.length ? <p className="state">No hemos encontrado planes con esos filtros.</p>
          : <div className="event-grid">{events.map((item) => <EventCard key={item.id} event={item} onBook={book} />)}</div>}
      </section>

      {session && <section id="reservas">
        <p className="eyebrow">Tu cuenta</p>
        <h2>Mis reservas</h2>
        {bookings.length ? <div className="booking-list">
          {bookings.map((item) => <article className="booking-item" key={item.id}>
            <div><strong>{item.title}</strong><p>{item.venue} · {item.event_date}</p></div>
            <span className="tag">{item.quantity} {item.quantity === 1 ? "entrada" : "entradas"}</span>
          </article>)}
        </div> : <p className="state">Todavía no tienes reservas. ¡Elige tu primer planazo!</p>}
      </section>}

      <section id="login" className="login">
        <p className="eyebrow">Tu cuenta Planazo</p>
        <h2>{mode === "login" ? "Accede a tu cuenta" : "Crea tu cuenta"}</h2>
        <a className="oauth-button github" href="/api/auth/oauth/github">Continuar con GitHub</a>
        <div className="divider"><span>o con tu email</span></div>
        <form onSubmit={submitAuth}>
          <input type="email" required value={auth.email} onChange={(event) => setAuth({ ...auth, email: event.target.value })} placeholder="tu@email.com" />
          <input type="password" required minLength="6" value={auth.password} onChange={(event) => setAuth({ ...auth, password: event.target.value })} placeholder="Contraseña (mínimo 6 caracteres)" />
          <button type="submit">{mode === "login" ? "Entrar" : "Registrarme"} ↗</button>
        </form>
        <button className="toggle" type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setMessage(""); }}>
          {mode === "login" ? "¿No tienes cuenta? Regístrate" : "Ya tengo una cuenta"}
        </button>
        {message && <p className="state">{message}</p>}
      </section>
    </main>

    <footer>© 2026 Planazo</footer>
  </>;
}

createRoot(document.getElementById("root")).render(<App />);
