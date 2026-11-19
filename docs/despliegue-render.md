# Despliegue en Render.com

El repositorio incluye `render.yaml` (Blueprint) y `Dockerfile`. El build compila el frontend React con Vite y el contenedor final sirve el bundle estático con FastAPI en el mismo servicio, de modo que las llamadas a `/api` son del mismo origen.

## URL publicada

> **https://planazo-o7us.onrender.com**

## Pasos

1. Abrir <https://render.com/deploy?repo=https://github.com/Nihilux-SP/Planazo-entradas>.
2. Render detecta `render.yaml` en la raíz. Rellenar `GITHUB_CLIENT_ID` y `GITHUB_CLIENT_SECRET` de la OAuth App de GitHub. `JWT_SECRET` se genera automáticamente.
3. Pulsar **Deploy Blueprint**. El servicio `planazo` queda en `https://planazo-o7us.onrender.com` (región Frankfurt, plan Free).
4. En la OAuth App de GitHub (<https://github.com/settings/developers>), la **Homepage URL** es `https://planazo-o7us.onrender.com/` y la **Authorization callback URL** es:
   ```
   https://planazo-o7us.onrender.com/api/auth/oauth/github/callback
   ```
   También se conserva el callback local `http://localhost:8000/api/auth/oauth/github/callback` para desarrollo.
5. Comprobar:
   - `https://planazo-o7us.onrender.com/api/health` → `{"status":"ok","service":"planazo-api"}`
   - `https://planazo-o7us.onrender.com/docs` → documentación de la API.
   - Registro con correo, login GitHub y reservas desde la raíz del sitio.

## Configuración automática

El código lee la variable que Render inyecta, `RENDER_EXTERNAL_URL`, para derivar:

- `OAUTH_REDIRECT_URI = <RENDER_EXTERNAL_URL>/api/auth/oauth/{provider}/callback`
- `FRONTEND_URI = <RENDER_EXTERNAL_URL>/`
- `CORS_ORIGINS` incluye `<RENDER_EXTERNAL_URL>`

Por eso no hay que escribir a mano la URL del servicio.

## Limitación del plan gratuito

El plan Hobby usa sistema de archivos efímero: la base de datos SQLite se reinicia en cada deploy o reactivación. Las cuentas demo (`admin@planazo.local`, `gestor@planazo.local`, `cliente@planazo.local`) se vuelven a crear automáticamente, pero los usuarios registrados y las reservas se pierden. Para conservarlos, añadir un disco persistente de 1 GB (≈ 0,25 $/mes) y montarlo en `/app/data`, o migrar a Render Postgres.
