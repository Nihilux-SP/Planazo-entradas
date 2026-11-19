# Planazo — aplicación web distribuida

Marketplace de entradas con **backend FastAPI**, **frontend React**, autenticación JWT con refresco, inicio de sesión con GitHub y tres roles (`ADMIN`, `GESTOR`, `CLIENTE`).

**URL publicada en Render:** _pendiente de asignar; se actualizará tras el despliegue_.

## Estructura

- `backend/`: API FastAPI + SQLite + JWT.
- `frontend/`: SPA React construida con Vite.
- `Dockerfile`: build multi-etapa; compila React y sirve el bundle con FastAPI.
- `render.yaml`: Blueprint para desplegar en Render.com.
- `docs/despliegue-render.md`: guía de despliegue.
- `docs/estudio-costes.md`: comparativa Render / AWS / Azure / Google Cloud.

## Funcionalidad

- Registro con correo y contraseña (PBKDF2-HMAC-SHA256, 210.000 iteraciones y salt aleatorio).
- Login con GitHub OAuth (state de un solo uso, email verificado).
- Access token JWT de 15 min + refresh token opaco de 7 días con rotación y revocación.
- Roles y endpoint `PATCH /api/auth/users/{id}/role` solo para `ADMIN`.
- CRUD de eventos, reservas y listado de reservas del usuario.
- Renovación automática del token en el frontend al recibir un `401`.

## Desarrollo local

```powershell
# API
cd backend
.\.venv\Scripts\uvicorn.exe app.main:app --reload --port 8000

# Frontend (en otra terminal)
cd frontend
npm install
npm run dev
```

Abre <http://localhost:8080>. La documentación de la API está en <http://localhost:8000/docs>.

Para arrancar todo con credenciales guardadas localmente: doble clic en `INICIAR.bat`.

## Despliegue

Ver `docs/despliegue-render.md`. Resumen: conectar este repositorio a Render desde `https://render.com/deploy?repo=https://github.com/Nihilux-SP/Planazo-entradas`, rellenar `GITHUB_CLIENT_ID` y `GITHUB_CLIENT_SECRET`, y aplicar el Blueprint. La URL del servicio se deriva automáticamente de `RENDER_EXTERNAL_URL`.
