from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import unicodedata
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request as HttpRequest, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator

ROOT = Path(__file__).resolve().parents[2]
DATABASE = Path(os.getenv("DATABASE_PATH", ROOT / "data" / "planazo.sqlite3"))
JWT_SECRET = os.getenv(
    "JWT_SECRET",
    "VGhpcy1pcy1hLWRldi1zZWNyZXQta2V5LWZvci1sb2NhbC1kZXZlbG9wbWVudC1vbmx5",
)
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = int(os.getenv("JWT_EXPIRATION_MINUTES", "15"))
REFRESH_TOKEN_DAYS = 7
GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID", "")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET", "")
RENDER_URL = os.getenv("RENDER_EXTERNAL_URL", "").rstrip("/")
OAUTH_REDIRECT_URI = os.getenv(
    "OAUTH_REDIRECT_URI",
    f"{RENDER_URL}/api/auth/oauth/{{provider}}/callback"
    if RENDER_URL
    else "http://localhost:8000/api/auth/oauth/{provider}/callback",
)
FRONTEND_URI = os.getenv("FRONTEND_URI", f"{RENDER_URL}/" if RENDER_URL else "http://localhost:8080/")
STATIC_DIR = Path(__file__).resolve().parent / "static"

REVOKED_TOKENS: set[str] = set()
OAUTH_STATES: dict[str, datetime] = {}
USER_AGENT = "planazo-auth/1.0"


def jwt_key() -> bytes:
    try:
        key = base64.b64decode(JWT_SECRET, validate=True)
    except (ValueError, TypeError):
        key = JWT_SECRET.encode()
    if len(key) < 32:
        raise RuntimeError("JWT_SECRET debe contener al menos 32 bytes")
    return key


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Planazo API", version="1.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv(
        "CORS_ORIGINS",
        ",".join(filter(None, ["http://localhost:8080", RENDER_URL])),
    ).split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_error(_: HttpRequest, exception: HTTPException) -> JSONResponse:
    detail = exception.detail if isinstance(exception.detail, str) else "La solicitud no es válida"
    return JSONResponse(status_code=exception.status_code, content={"error": detail})


@app.exception_handler(RequestValidationError)
async def validation_error(_: HttpRequest, exception: RequestValidationError) -> JSONResponse:
    first = exception.errors()[0]
    return JSONResponse(status_code=422, content={"error": f"Campo no válido: {'.'.join(str(item) for item in first['loc'])}"})


EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def validate_email(value: str) -> str:
    value = value.strip().lower()
    if not EMAIL_PATTERN.fullmatch(value):
        raise ValueError("El email no es válido")
    return value


EmailText = Annotated[str, Field(min_length=3, max_length=254), AfterValidator(validate_email)]


class User(BaseModel):
    id: int
    email: EmailText
    role: str = "CLIENTE"


class AuthRequest(BaseModel):
    email: EmailText
    password: str = Field(min_length=6, max_length=100)


class RefreshRequest(BaseModel):
    refreshToken: str = Field(min_length=1)


class EventRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    type: str = Field(min_length=1, max_length=30)
    title: str = Field(min_length=1, max_length=180)
    venue: str = Field(min_length=1, max_length=180)
    city: str = Field(min_length=1, max_length=80)
    date: str
    time: str = Field(pattern=r"^\d{2}:\d{2}$")
    price: int = Field(ge=0)
    image: str = Field(min_length=1, max_length=30)
    accent: str = Field(min_length=1, max_length=20)
    featured: bool

    @field_validator("date")
    @classmethod
    def valid_date(cls, value: str) -> str:
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError as exc:
            raise ValueError("La fecha debe tener el formato yyyy-MM-dd") from exc
        return value


class Event(EventRequest):
    id: int


class BookingRequest(BaseModel):
    eventId: int
    quantity: int = Field(ge=1, le=10)


def db() -> sqlite3.Connection:
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db() -> None:
    with db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL,
                venue TEXT NOT NULL, city TEXT NOT NULL, event_date TEXT NOT NULL,
                event_time TEXT NOT NULL, price INTEGER NOT NULL, image TEXT NOT NULL,
                accent TEXT NOT NULL, featured INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'CLIENTE',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS refresh_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
                token_hash TEXT UNIQUE NOT NULL, expires_at TEXT NOT NULL,
                revoked_at TEXT, FOREIGN KEY(user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS bookings (
                id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
                event_id INTEGER NOT NULL, quantity INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id),
                FOREIGN KEY(event_id) REFERENCES events(id)
            );
            """
        )
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(users)")}
        if "role" not in columns:
            connection.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'CLIENTE'")
        seed_user(connection, "admin@planazo.local", "AdminPlanazo2026!", "ADMIN")
        seed_user(connection, "gestor@planazo.local", "GestorPlanazo2026!", "GESTOR")
        seed_user(connection, "cliente@planazo.local", "ClientePlanazo2026!", "CLIENTE")
        if connection.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0:
            connection.executemany(
                """INSERT INTO events
                (id,type,title,venue,city,event_date,event_time,price,image,accent,featured)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                [
                    (1, "Concierto", "The Weeknd · After Hours", "Palau Sant Jordi", "Barcelona", "2026-11-07", "21:00", 68, "concert", "#ffb86b", 1),
                    (2, "Teatro", "La casa de Bernarda Alba", "Teatro Español", "Madrid", "2026-10-24", "20:30", 24, "theatre", "#d5b4ff", 0),
                    (3, "Cine", "Ciclo: Ciencia ficción", "Cines Renoir", "Valencia", "2026-10-18", "18:00", 9, "cinema", "#7dd3fc", 0),
                    (4, "Concierto", "Rosalía · Motomami Live", "WiZink Center", "Madrid", "2026-12-12", "22:00", 52, "concert", "#fb7185", 1),
                    (5, "Teatro", "El fantasma de la ópera", "Teatro Coliseum", "Barcelona", "2026-11-20", "19:00", 31, "theatre", "#f0abfc", 0),
                    (6, "Cine", "Noches de autor", "Filmoteca Española", "Madrid", "2026-10-30", "19:30", 7, "cinema", "#93c5fd", 0),
                ],
            )


def seed_user(connection: sqlite3.Connection, email: str, password: str, role: str) -> None:
    if connection.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone() is None:
        connection.execute(
            "INSERT INTO users(email,password_hash,role,created_at) VALUES (?,?,?,?)",
            (email, hash_password(password), role, datetime.now(timezone.utc).isoformat()),
        )


def normalize(value: str) -> str:
    return "".join(
        char for char in unicodedata.normalize("NFD", value.strip().lower())
        if unicodedata.category(char) != "Mn"
    )


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 210_000)
    return base64.b64encode(salt + digest).decode()


def verify_password(password: str, encoded: str) -> bool:
    try:
        raw = base64.b64decode(encoded)
        expected = hashlib.pbkdf2_hmac("sha256", password.encode(), raw[:16], 210_000)
        return hmac.compare_digest(expected, raw[16:])
    except (ValueError, TypeError):
        return False


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def user_from_row(row: sqlite3.Row) -> User:
    return User(id=row["id"], email=row["email"], role=row["role"])


def token_response(user: User) -> dict:
    now = datetime.now(timezone.utc)
    access_token = jwt.encode(
        {
            "sub": str(user.id),
            "email": user.email,
            "role": user.role,
            "jti": secrets.token_urlsafe(12),
            "iat": now,
            "exp": now + timedelta(minutes=ACCESS_TOKEN_MINUTES),
        },
        jwt_key(),
        algorithm=JWT_ALGORITHM,
    )
    refresh_token = f"{secrets.token_urlsafe(32)}.{secrets.token_urlsafe(32)}"
    with db() as connection:
        connection.execute(
            "INSERT INTO refresh_tokens(user_id,token_hash,expires_at) VALUES (?,?,?)",
            (
                user.id,
                sha256(refresh_token),
                (now + timedelta(days=REFRESH_TOKEN_DAYS)).isoformat(),
            ),
        )
    return {
        "token": access_token,
        "refreshToken": refresh_token,
        "expiresIn": ACCESS_TOKEN_MINUTES * 60,
        "user": user,
    }


def current_user(authorization: Annotated[str | None, Header()] = None) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Debes iniciar sesión")
    token = authorization[7:].strip()
    if token in REVOKED_TOKENS:
        raise HTTPException(status_code=401, detail="La sesión ha caducado")
    try:
        claims = jwt.decode(token, jwt_key(), algorithms=[JWT_ALGORITHM])
        user_id = int(claims["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="El token no es válido o ha caducado")
    with db() as connection:
        row = connection.execute("SELECT id,email,role FROM users WHERE id=?", (user_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=401, detail="El usuario ya no existe")
    return user_from_row(row)


def require_role(user: User, *roles: str) -> User:
    if user.role not in roles:
        raise HTTPException(status_code=403, detail="No tienes permisos para esta operación")
    return user


def find_or_create_oauth_user(email: str) -> User:
    email = email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="El proveedor no ha proporcionado un email válido")
    with db() as connection:
        row = connection.execute("SELECT id,email,role FROM users WHERE email=?", (email,)).fetchone()
        if row is None:
            unusable_password = hash_password(f"oauth-{secrets.token_urlsafe(32)}")
            cursor = connection.execute(
                "INSERT INTO users(email,password_hash,role,created_at) VALUES (?,?,?,?)",
                (email, unusable_password, "CLIENTE", datetime.now(timezone.utc).isoformat()),
            )
            return User(id=cursor.lastrowid, email=email, role="CLIENTE")
        return user_from_row(row)


def github_get(path: str, access_token: str) -> object:
    request = Request(
        f"https://api.github.com{path}",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urlopen(request, timeout=10) as response:
            return json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="No se pudo consultar el perfil de GitHub") from exc


def github_email(access_token: str) -> str:
    emails = github_get("/user/emails", access_token)
    if isinstance(emails, list):
        for item in emails:
            if isinstance(item, dict) and item.get("verified") and item.get("primary"):
                return str(item.get("email", ""))
        for item in emails:
            if isinstance(item, dict) and item.get("verified"):
                return str(item.get("email", ""))
    profile = github_get("/user", access_token)
    if isinstance(profile, dict):
        return str(profile.get("email") or "")
    return ""


def exchange_github_code(code: str) -> str:
    data = urlencode(
        {
            "client_id": GITHUB_CLIENT_ID,
            "client_secret": GITHUB_CLIENT_SECRET,
            "code": code,
            "redirect_uri": OAUTH_REDIRECT_URI.replace("{provider}", "github"),
        }
    ).encode()
    request = Request(
        "https://github.com/login/oauth/access_token",
        data=data,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urlopen(request, timeout=10) as response:
            payload = json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="No se pudo completar la autenticación con GitHub") from exc
    token = payload.get("access_token") if isinstance(payload, dict) else None
    if not token:
        raise HTTPException(status_code=502, detail="GitHub no devolvió un token válido")
    return str(token)


def event_from_row(row: sqlite3.Row) -> Event:
    return Event(
        id=row["id"], type=row["type"], title=row["title"], venue=row["venue"],
        city=row["city"], date=row["event_date"], time=row["event_time"],
        price=row["price"], image=row["image"], accent=row["accent"], featured=bool(row["featured"]),
    )


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "planazo-api"}


@app.post("/api/auth/register", status_code=201)
def register(request: AuthRequest) -> dict:
    email = request.email.lower()
    try:
        with db() as connection:
            cursor = connection.execute(
                "INSERT INTO users(email,password_hash,role,created_at) VALUES (?,?,?,?)",
                (email, hash_password(request.password), "CLIENTE", datetime.now(timezone.utc).isoformat()),
            )
            user = User(id=cursor.lastrowid, email=email, role="CLIENTE")
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=400, detail="El email ya está registrado") from exc
    return {**token_response(user), "message": "Cuenta creada correctamente"}


@app.post("/api/auth/login")
def login(request: AuthRequest) -> dict:
    with db() as connection:
        row = connection.execute("SELECT * FROM users WHERE email=?", (request.email.lower(),)).fetchone()
    if not row or not verify_password(request.password, row["password_hash"]):
        raise HTTPException(status_code=400, detail="Email o contraseña incorrectos")
    return token_response(user_from_row(row))


@app.post("/api/auth/refresh")
def refresh(request: RefreshRequest) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    with db() as connection:
        row = connection.execute(
            """SELECT r.user_id,u.email,u.role FROM refresh_tokens r
               JOIN users u ON u.id=r.user_id
               WHERE r.token_hash=? AND r.revoked_at IS NULL AND r.expires_at>?""",
            (sha256(request.refreshToken), now),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=401, detail="El refresh token no es válido o ha caducado")
        connection.execute(
            "UPDATE refresh_tokens SET revoked_at=? WHERE token_hash=?",
            (now, sha256(request.refreshToken)),
        )
        user = User(id=row["user_id"], email=row["email"], role=row["role"])
    return token_response(user)


@app.get("/api/auth/me")
def me(user: Annotated[User, Depends(current_user)]) -> dict:
    return {"user": user}


@app.post("/api/auth/logout")
def logout(
    authorization: Annotated[str | None, Header()] = None,
    refreshToken: Annotated[str | None, Query()] = None,
) -> dict:
    if authorization and authorization.startswith("Bearer "):
        REVOKED_TOKENS.add(authorization[7:].strip())
    if refreshToken:
        with db() as connection:
            connection.execute(
                "UPDATE refresh_tokens SET revoked_at=? WHERE token_hash=?",
                (datetime.now(timezone.utc).isoformat(), sha256(refreshToken)),
            )
    return {"message": "Sesión cerrada"}


@app.patch("/api/auth/users/{user_id}/role")
def change_role(
    user_id: int,
    role: Annotated[str, Query()],
    user: Annotated[User, Depends(current_user)],
) -> dict:
    require_role(user, "ADMIN")
    if role not in {"ADMIN", "GESTOR", "CLIENTE"}:
        raise HTTPException(status_code=400, detail="El rol no es válido")
    with db() as connection:
        if connection.execute("SELECT 1 FROM users WHERE id=?", (user_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="El usuario no existe")
        connection.execute("UPDATE users SET role=? WHERE id=?", (role, user_id))
        row = connection.execute("SELECT id,email,role FROM users WHERE id=?", (user_id,)).fetchone()
    return {"user": user_from_row(row)}


@app.get("/api/auth/oauth/{provider}")
def start_oauth(provider: str) -> Response:
    if provider.lower() != "github":
        raise HTTPException(status_code=404, detail="Proveedor de inicio de sesión no disponible")
    if not GITHUB_CLIENT_ID or not GITHUB_CLIENT_SECRET:
        raise HTTPException(status_code=503, detail="El inicio de sesión con GitHub no está configurado")
    state = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    for key, expires in list(OAUTH_STATES.items()):
        if expires < now:
            OAUTH_STATES.pop(key, None)
    OAUTH_STATES[state] = now + timedelta(minutes=10)
    query = urlencode(
        {
            "client_id": GITHUB_CLIENT_ID,
            "redirect_uri": OAUTH_REDIRECT_URI.replace("{provider}", "github"),
            "response_type": "code",
            "scope": "read:user user:email",
            "state": state,
            "allow_signup": "true",
        }
    )
    return RedirectResponse(f"https://github.com/login/oauth/authorize?{query}", status_code=302)


@app.get("/api/auth/oauth/{provider}/callback")
def finish_oauth(provider: str, code: str, state: str) -> Response:
    if provider.lower() != "github":
        raise HTTPException(status_code=404, detail="Proveedor de inicio de sesión no disponible")
    expires = OAUTH_STATES.pop(state, None)
    if expires is None or expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="La solicitud de inicio de sesión no es válida o ha caducado")
    if not GITHUB_CLIENT_ID or not GITHUB_CLIENT_SECRET:
        raise HTTPException(status_code=503, detail="El inicio de sesión con GitHub no está configurado")
    user = find_or_create_oauth_user(github_email(exchange_github_code(code)))
    session = token_response(user)
    redirect = f"{FRONTEND_URI.rstrip('/')}/#oauth_token={session['token']}&oauth_refresh_token={session['refreshToken']}"
    return RedirectResponse(redirect, status_code=302)


@app.get("/api/events")
def list_events(search: str = "", type: str = "Todos", city: str = "Todas") -> dict:
    with db() as connection:
        rows = connection.execute(
            "SELECT * FROM events WHERE (?='Todos' OR type=?) AND (?='Todas' OR city=?) ORDER BY event_date,event_time",
            (type, type, city, city),
        ).fetchall()
    query = normalize(search)
    events = [event_from_row(row) for row in rows if not query or query in normalize(f"{row['title']} {row['venue']} {row['city']}")]
    return {"data": events, "total": len(events)}


@app.get("/api/events/featured")
def featured() -> dict:
    with db() as connection:
        rows = connection.execute("SELECT * FROM events WHERE featured=1 ORDER BY event_date").fetchall()
    return {"data": [event_from_row(row) for row in rows]}


def get_event(event_id: int) -> Event:
    with db() as connection:
        row = connection.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="El evento no existe")
    return event_from_row(row)


@app.get("/api/events/{event_id}")
def read_event(event_id: int) -> dict:
    return {"data": get_event(event_id)}


@app.post("/api/events", status_code=201)
def create_event(request: EventRequest, user: Annotated[User, Depends(current_user)]) -> dict:
    require_role(user, "ADMIN", "GESTOR")
    with db() as connection:
        event_id = connection.execute("SELECT COALESCE(MAX(id),0)+1 FROM events").fetchone()[0]
        connection.execute(
            "INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (event_id, request.type, request.title, request.venue, request.city, request.date, request.time, request.price, request.image, request.accent, int(request.featured)),
        )
    return {"data": get_event(event_id)}


@app.put("/api/events/{event_id}")
def update_event(event_id: int, request: EventRequest, user: Annotated[User, Depends(current_user)]) -> dict:
    require_role(user, "ADMIN", "GESTOR")
    get_event(event_id)
    with db() as connection:
        connection.execute(
            "UPDATE events SET type=?,title=?,venue=?,city=?,event_date=?,event_time=?,price=?,image=?,accent=?,featured=? WHERE id=?",
            (request.type, request.title, request.venue, request.city, request.date, request.time, request.price, request.image, request.accent, int(request.featured), event_id),
        )
    return {"data": get_event(event_id)}


@app.delete("/api/events/{event_id}", status_code=204)
def delete_event(event_id: int, user: Annotated[User, Depends(current_user)]) -> Response:
    require_role(user, "ADMIN", "GESTOR")
    get_event(event_id)
    try:
        with db() as connection:
            connection.execute("DELETE FROM events WHERE id=?", (event_id,))
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="No se puede eliminar el evento porque tiene reservas asociadas") from exc
    return Response(status_code=204)


@app.post("/api/bookings", status_code=201)
def create_booking(request: BookingRequest, user: Annotated[User, Depends(current_user)]) -> dict:
    get_event(request.eventId)
    created_at = datetime.now(timezone.utc).isoformat()
    with db() as connection:
        cursor = connection.execute(
            "INSERT INTO bookings(user_id,event_id,quantity,created_at) VALUES (?,?,?,?)",
            (user.id, request.eventId, request.quantity, created_at),
        )
    booking = {"id": cursor.lastrowid, "eventId": request.eventId, "quantity": request.quantity, "createdAt": created_at}
    return {"data": booking, "message": f"Reserva confirmada para {request.quantity} entrada{'s' if request.quantity != 1 else ''}."}


@app.get("/api/bookings/me")
def my_bookings(user: Annotated[User, Depends(current_user)]) -> list[dict]:
    with db() as connection:
        rows = connection.execute(
            """SELECT b.id,b.event_id,b.quantity,b.created_at,e.title,e.venue,e.event_date
               FROM bookings b JOIN events e ON e.id=b.event_id
               WHERE b.user_id=? ORDER BY b.created_at DESC""",
            (user.id,),
        ).fetchall()
    return [dict(row) for row in rows]


# En producción el mismo contenedor sirve el bundle de React. En desarrollo
# (sin carpeta static) Vite se encarga del frontend y solo se usa la API.
if STATIC_DIR.is_dir():
    if (STATIC_DIR / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> FileResponse:
        candidate = (STATIC_DIR / full_path).resolve()
        if candidate.is_file() and candidate.is_relative_to(STATIC_DIR.resolve()):
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")
