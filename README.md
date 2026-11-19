# Planazo · Spring Boot

Marketplace responsive para descubrir y reservar entradas de conciertos, teatro y cine. El proyecto está construido íntegramente con **Spring Boot 3.5.6 / Java 25**: la API REST y la interfaz web se sirven desde el mismo puerto, con los archivos estáticos en `src/main/resources/static`.

## Arranque local

```powershell
mvn spring-boot:run
```

Abre <http://localhost:8080>. También puedes empaquetar y ejecutar el JAR:

```powershell
mvn clean package -DskipTests
java -jar target/entradas-app-0.0.1-SNAPSHOT.jar
```

El script `INICIAR.bat` / `INICIAR.ps1` crea un `.env.local` (no versionado) con el `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` y un `JWT_SECRET` aleatorio, los carga en el entorno y arranca la aplicación.

## Funcionalidades

- Catálogo de 12 eventos con búsqueda, filtros por tipo/ciudad, ordenación por fecha, precio o título y filtro de destacados.
- Registro e inicio de sesión con email y contraseña, con sesión automática y renovación del access token mediante refresh token rotatorio.
- Inicio de sesión con GitHub y Google (OAuth 2.0, parámetro `state`, sin secretos en el navegador).
- Favoritos y reservas por usuario, con cancelación de reservas.
- Panel de administración para crear, editar y eliminar eventos y para cambiar roles (`ADMIN`, `GESTOR`, `CLIENTE`).
- Diseño responsive, tema claro/oscuro, toasts, estados de carga/vacío/error y navegación accesible.

## Credenciales de demostración

Estas cuentas se crean automáticamente al iniciar la aplicación si no existen:

| Rol | Email | Contraseña |
|---|---|---|
| `ADMIN` | `admin@planazo.local` | `AdminPlanazo2026!` |
| `GESTOR` | `gestor@planazo.local` | `GestorPlanazo2026!` |
| `CLIENTE` | `cliente@planazo.local` | `ClientePlanazo2026!` |

Cámbialas o elimínalas antes de usar la aplicación en producción.

## API REST

Base: `/api`. Las rutas protegidas requieren `Authorization: Bearer <token>`.

| Método | Ruta | Descripción | Acceso |
|---|---|---|---|
| `GET` | `/health` | Estado del servicio | público |
| `GET` | `/stats` | Contadores de eventos, ciudades, reservas y usuarios | público |
| `GET` | `/events?search=&type=&city=&sort=date\|price-asc\|price-desc\|title` | Catálogo filtrado y ordenado | público |
| `GET` | `/events/featured` | Eventos destacados | público |
| `GET` | `/events/{id}` | Detalle de un evento | público |
| `POST` | `/events` | Crear evento | `ADMIN`, `GESTOR` |
| `PUT` | `/events/{id}` | Editar evento | `ADMIN`, `GESTOR` |
| `DELETE` | `/events/{id}` | Eliminar evento | `ADMIN`, `GESTOR` |
| `POST` | `/auth/register` | Registro (devuelve tokens) | público |
| `POST` | `/auth/login` | Login con email y contraseña | público |
| `POST` | `/auth/refresh` | Rota el refresh token | público |
| `GET` | `/auth/me` | Usuario actual | autenticado |
| `POST` | `/auth/logout` | Revoca tokens | autenticado |
| `GET` | `/auth/oauth/{provider}` | Inicia OAuth (`github`, `google`) | público |
| `GET` | `/auth/oauth/{provider}/callback` | Callback OAuth | público |
| `GET` | `/auth/users` | Listado de usuarios | `ADMIN` |
| `PATCH` | `/auth/users/{id}/role?role=ADMIN\|GESTOR\|CLIENTE` | Cambiar rol | `ADMIN` |
| `POST` | `/bookings` | Crear reserva | autenticado |
| `GET` | `/bookings/me` | Reservas del usuario | autenticado |
| `DELETE` | `/bookings/{id}` | Cancelar reserva | autenticado |
| `GET` | `/favorites` | IDs de favoritos del usuario | autenticado |
| `POST` | `/favorites/{eventId}` | Añadir favorito | autenticado |
| `DELETE` | `/favorites/{eventId}` | Quitar favorito | autenticado |

El access JWT caduca a los 15 minutos y el refresh token a los 7 días. El refresh se guarda solo como SHA-256, se rota en cada uso y se revoca al cerrar sesión. Las contraseñas usan BCrypt con coste 12. La clave JWT se lee de `JWT_SECRET` (Base64, mínimo 32 bytes) y en producción debe ser propia.

## Configuración

Variables de entorno admitidas (valores por defecto para desarrollo local):

| Variable | Uso |
|---|---|
| `JWT_SECRET` | Firma de los JWT |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | OAuth de GitHub |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth de Google |
| `OAUTH_REDIRECT_URI` | Plantilla de callback, `{provider}` se sustituye por `github` o `google` |
| `FRONTEND_URI` | URL a la que vuelve el flujo OAuth |
| `RENDER_EXTERNAL_URL` | La inyecta Render; sirve para derivar las dos URLs anteriores |
| `SPRING_DATASOURCE_URL` | Cadena JDBC de H2 (en Render apunta a `/app/data/planazo`) |

## Despliegue

**URL publicada:** <https://planazo-o7us.onrender.com>

El repo incluye `render.yaml` y un `Dockerfile` multi-etapa que compila con Maven y ejecuta el JAR con Java 25. Instrucciones en [docs/despliegue-render.md](docs/despliegue-render.md) y comparativa de costes en [docs/estudio-costes.md](docs/estudio-costes.md).

> El plan gratuito de Render usa sistema de archivos efímero: la base de datos H2 se reinicia en cada deploy o reactivación. Las cuentas demo y los 12 eventos se vuelven a sembrar automáticamente, pero los usuarios, favoritos y reservas creados por los visitantes se pierden. Para conservarlos, monta un disco persistente en `/app/data` o migra a una base de datos gestionada.
