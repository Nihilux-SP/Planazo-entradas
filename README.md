# Credenciales de demostración

Estas cuentas se crean automáticamente al iniciar la aplicación si todavía no existen:

| Rol | Email | Contraseña |
|---|---|---|
| Administrador (`ADMIN`) | `admin@planazo.local` | `AdminPlanazo2026!` |
| Gestor (`GESTOR`) | `gestor@planazo.local` | `GestorPlanazo2026!` |
| Cliente (`CLIENTE`) | `cliente@planazo.local` | `ClientePlanazo2026!` |

Son credenciales locales de demostración. Cámbialas o elimínalas antes de desplegar la aplicación en producción.

# Planazo · Spring Boot

Marketplace responsive para reservar entradas de conciertos, obras de teatro y cine.

## Arquitectura actualizada

El runtime nuevo está separado en:

- `backend/`: API en Python con FastAPI, SQLite y JWT.
- `frontend/`: aplicación React construida con Vite.

### Ejecutar con Spring Boot

La aplicación principal usa Spring Boot, H2 y JWT. Spring sirve el frontend compilado y la API en el mismo puerto:

```powershell
mvn spring-boot:run
```

Después abre <http://localhost:8080>.

### Desarrollo separado (opcional)

El código fuente original de la API FastAPI se conserva en `backend/` y el frontend React en `frontend/`:

```powershell
cd backend
.\.venv\Scripts\uvicorn app.main:app --reload --port 8000

cd frontend
npm install
npm run dev
```

En desarrollo separado, Vite se sirve en `http://localhost:8080` y usa un proxy hacia la API en `http://localhost:8000`. El contrato REST se mantiene para filtros, JWT, CRUD de eventos y reservas.

### Despliegue en Render.com

**URL publicada:** **https://planazo-o7us.onrender.com**

La entrega `entrega-final/` del repositorio de actividades incluye `render.yaml` y `Dockerfile`. El Blueprint crea un Web Service Hobby que compila React y sirve la API y el frontend en el mismo dominio. Instrucciones completas en `docs/despliegue-render.md`.

Comparativa de coste con AWS, Azure y Google Cloud: `docs/estudio-costes.md`.

#### Inicio de sesión con GitHub en la pila FastAPI + React

1. Crea una OAuth App en <https://github.com/settings/developers>:
   - **Homepage URL:** `http://localhost:8080`
   - **Authorization callback URL:** `http://localhost:8000/api/auth/oauth/github/callback`
2. Configura las variables de entorno (puedes usar `backend/.env.example` como guía):

```powershell
$env:GITHUB_CLIENT_ID = "..."
$env:GITHUB_CLIENT_SECRET = "..."
$env:FRONTEND_URI = "http://localhost:8080/"
$env:JWT_SECRET = "..."  # Base64, mínimo 32 bytes
```

3. Arranca la API y Vite. El botón **Continuar con GitHub** redirige a GitHub, valida el parámetro `state`, intercambia el código en el servidor y devuelve al navegador al frontend con el access token y el refresh token. Si el email no existe se crea un usuario `CLIENTE`; si ya existe se usa esa cuenta.

El frontend React permite además registrarse con correo y contraseña, guarda la sesión en `localStorage` y renueva automáticamente el access token cuando recibe un `401`.

#### API FastAPI (desarrollo separado)

Además de los endpoints listados más abajo, la API FastAPI expone:

- `GET /api/health` — comprobación de estado.
- `POST /api/auth/refresh` — rota el refresh token y emite una nueva sesión.
- `GET /api/auth/oauth/{provider}` y `GET /api/auth/oauth/{provider}/callback` — flujo OAuth (actualmente `github`).
- `PATCH /api/auth/users/{id}/role?role=ADMIN|GESTOR|CLIENTE` — solo `ADMIN`.

El registro y el login devuelven `{ token, refreshToken, expiresIn, user }`. Las cuentas demo (`admin@planazo.local`, `gestor@planazo.local`, `cliente@planazo.local`) también se crean automáticamente en SQLite.

## Ejecutar

La ejecución recomendada es `mvn spring-boot:run`, que deja todo disponible en `http://localhost:8080`.

## API

- `GET /api/events?search=&type=Todos&city=Todas`
- `GET /api/events/{id}`
- `POST /api/events` autenticado
- `PUT /api/events/{id}` autenticado
- `DELETE /api/events/{id}` autenticado
- `GET /api/events/featured`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `PATCH /api/auth/users/{id}/role` (solo `ADMIN`)
- `POST /api/bookings` autenticado
- `GET /api/bookings/me` autenticado

Las rutas autenticadas requieren:

```http
Authorization: Bearer <token>
```

El registro público siempre crea usuarios con rol `CLIENTE`. Los tres roles disponibles son `ADMIN`, `GESTOR` y `CLIENTE`; solo un administrador puede cambiar roles mediante `PATCH /api/auth/users/{id}/role`.

El login devuelve un access JWT firmado con caducidad de 15 minutos y un refresh token válido durante 7 días. El refresh token se almacena únicamente como SHA-256, se rota en cada uso y se revoca al cerrar sesión. El cliente renueva automáticamente el access token cuando recibe un `401`.

Las contraseñas se almacenan con BCrypt con coste 12; nunca se guardan en claro ni con un hash reversible. La clave JWT se configura con `JWT_SECRET` en Base64 y debe contener al menos 32 bytes. En producción es obligatorio establecer una clave propia y segura.

Los eventos, usuarios y reservas se guardan en H2 en `./data/planazo`. Las contraseñas se almacenan con BCrypt. El cierre de sesión revoca el token hasta que se reinicia el servidor.

## Inicio de sesión con Google y GitHub

El formulario también permite iniciar sesión mediante OAuth 2.0 con Google o GitHub.
Cada proveedor debe tener una aplicación OAuth configurada con estas URLs de callback:

- Google: `http://localhost:8080/api/auth/oauth/google/callback`
- GitHub: `http://localhost:8080/api/auth/oauth/github/callback`

Configura los secretos como variables de entorno antes de arrancar Spring Boot:

```powershell
$env:GOOGLE_CLIENT_ID = "..."
$env:GOOGLE_CLIENT_SECRET = "..."
$env:GITHUB_CLIENT_ID = "..."
$env:GITHUB_CLIENT_SECRET = "..."
$env:OAUTH_REDIRECT_URI = "http://localhost:8080/api/auth/oauth/{provider}/callback"
```

En producción, cambia también `FRONTEND_URI` por la URL pública de la aplicación.
El backend valida el parámetro `state`, intercambia el código en el servidor y nunca
expone los secretos OAuth al navegador. El usuario social se crea con rol `CLIENTE`
si su email todavía no existe; si ya existe, se vincula a la cuenta existente.
