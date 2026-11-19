# Despliegue en Render.com

El repositorio contiene un `render.yaml` (Blueprint) y un `Dockerfile` multi-etapa: la primera etapa compila el proyecto con Maven y la segunda ejecuta el JAR con Java 25. Spring Boot sirve la API REST y la interfaz web en el mismo puerto, por lo que las llamadas a `/api` son del mismo origen.

## URL publicada

> **https://planazo-o7us.onrender.com**

## Pasos

1. Abrir <https://render.com/deploy?repo=https://github.com/Nihilux-SP/Planazo-entradas>.
2. Render detecta `render.yaml` en la raíz. Rellenar `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` de las aplicaciones OAuth. `JWT_SECRET` se genera automáticamente.
3. Pulsar **Deploy Blueprint**. El servicio `planazo` queda en `https://planazo-o7us.onrender.com` (región Frankfurt, plan Free).
4. En la OAuth App de GitHub (<https://github.com/settings/developers>), la **Homepage URL** es `https://planazo-o7us.onrender.com/` y la **Authorization callback URL** es:
   ```
   https://planazo-o7us.onrender.com/api/auth/oauth/github/callback
   ```
   Para Google, usa la misma URL con `google` en lugar de `github`. La URL de callback local es `http://localhost:8080/api/auth/oauth/{provider}/callback`.
5. Comprobar:
   - `https://planazo-o7us.onrender.com/api/health` → `{"status":"ok","service":"planazo-api","runtime":"spring-boot"}`
   - `https://planazo-o7us.onrender.com/api/stats` → contadores del catálogo.
   - `https://planazo-o7us.onrender.com/` → interfaz web con los 12 eventos.
   - Registro con correo, login GitHub/Google, favoritos, reservas y panel de administración.

## Configuración automática

La aplicación lee la variable que Render inyecta, `RENDER_EXTERNAL_URL`, para derivar:

- `OAUTH_REDIRECT_URI = <RENDER_EXTERNAL_URL>/api/auth/oauth/{provider}/callback`
- `FRONTEND_URI = <RENDER_EXTERNAL_URL>/`

El contenedor define `SPRING_DATASOURCE_URL=jdbc:h2:file:/app/data/planazo;MODE=PostgreSQL;AUTO_SERVER=TRUE` y Render establece `PORT=8080`; el `CMD` del Dockerfile pasa ese puerto a Spring Boot. Por eso no hay que escribir a mano la URL del servicio.

## Limitación del plan gratuito

El plan Hobby usa sistema de archivos efímero: la base de datos H2 se reinicia en cada deploy o reactivación. Las cuentas demo (`admin@planazo.local`, `gestor@planazo.local`, `cliente@planazo.local`) y los eventos se vuelven a crear automáticamente, pero los usuarios registrados, favoritos y reservas se pierden. Para conservarlos, añadir un disco persistente de 1 GB (≈ 0,25 $/mes) montado en `/app/data`, o migrar a Render Postgres.
