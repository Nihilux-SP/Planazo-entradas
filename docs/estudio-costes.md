# Estudio comparativo de coste de explotación

**Aplicación:** Planazo (FastAPI + React, autenticación JWT con refresh, GitHub OAuth, roles y reservas).
**Fecha de consulta de precios:** 19 de noviembre de 2026.
**Moneda:** USD/mes. Regiones europeas cuando existen (Render Frankfurt, AWS eu-central-1, Azure West Europe, GCP europe-west1).

## 1. Hipótesis de la comparativa

Para que las cifras sean comparables se estima una **explotación académica/demo**:

- 1 servicio web (API + frontend estático) y 1 base de datos.
- Tráfico bajo: < 10.000 peticiones/mes y < 5 GB de transferencia saliente.
- HTTPS gestionado, un único dominio, sin SLA contractual.
- Se excluyen créditos promocionales de alta categoría y se indican aparte los periodos de prueba.
- Los importes son **orientativos**; antes de contratar hay que usar las calculadoras oficiales.

> Nota importante para esta app: el código usa SQLite por defecto. En Render/GCP/AWS/Azure el sistema de archivos efímero pierde la base de datos al reiniciar. Para una explotación real hay que migrar a PostgreSQL gestionado o montar un disco persistente; ambos casos se reflejan en la tabla.

## 2. Tabla comparativa

| Proveedor | Arquitectura mínima recomendada | Coste mensual aprox. (demo) | Coste mensual aprox. (producción ligera) | Complejidad operativa |
|---|---|---:|---:|---|
| **Render** | Web Service Hobby (Docker, 512 MB) + SQLite efímero. Blueprint `render.yaml`. | **0 $** | **7,25 $** (0,5 CPU/512 MB = 7 $ + 1 GB SSD = 0,25 $). Postgres gestionado plan pequeño ≈ 6-19 $ adicionales. | **Muy baja**: deploy desde Git, TLS y CDN incluidos. |
| **AWS** | Elastic Beanstalk Standard, 1 × t3.micro (8 GB EBS + IP pública). Opcional ALB + RDS. | **≈ 12 $** (el Free Tier de 6 meses lo cubre con créditos). ≈ 29 $ con ALB según ejemplo oficial. | **≈ 25-45 $** añadiendo RDS db.t3.micro (≈ 12-15 $) y ALB (≈ 16-18 $). | **Media-alta**: VPC, ALB, RDS, IAM, CloudWatch. |
| **MS Azure** | App Service F1 (gratis, 60 CPU-min/día, 1 GB, sin SLA) o B1 Linux (1 vCPU/1,75 GB). PostgreSQL Flexible Server B1ms. | **0 $** con F1 (solo desarrollo) / **≈ 13 $** con B1 Linux. | **≈ 26-30 $** (B1 Linux ≈ 13,14 $ + PostgreSQL B1ms ≈ 13-16 $). El plan B1ms es burstable y no factura cuando está parado. | **Media**: integración con GitHub Actions y Azure AD; bien documentado. |
| **Google Cloud** | Cloud Run (facturación por petición, 1 vCPU/512 MiB) + SQLite en contenedor. O Cloud SQL PostgreSQL. | **0-3 $**: 2 M peticiones, 180.000 vCPU-s y 360.000 GiB-s gratis/mes. | **≈ 8-18 $** con Cloud SQL PostgreSQL compartido (≈ 8-15 $); el ejemplo oficial de 10 M peticiones con 1 vCPU/512 MiB es ≈ 13,69 $. | **Media**: escalado a cero y sin servidores, pero hay que configurar Cloud SQL/Artifact Registry. |

## 3. Desglose por proveedor

### Render
El plan *Hobby* cuesta 0 $/mes más compute. El Web Service **Free** tiene 512 MB de RAM y 5 GB de banda incluidos; se suspende tras un periodo de inactividad y tarda en reactivarse. El siguiente escalón (menos de 1 CPU, 512 MB) cuesta **7 $/mes**. Los discos SSD persistentes cuestan **0,25 $/GB/mes** y Postgres empieza en 0 $ (free, 256 MB, 100 conexiones) o 6 $/mes (menos de 1 CPU, 256 MB).

**Ventajas para esta entrega:** un solo `render.yaml` crea el servicio, el build compila React y ejecuta Uvicorn, y la URL pública sale lista con TLS. Es la opción más barata y rápida para el despliegue solicitado.

**Riesgo:** sin disco, usuarios y reservas se reinician con cada deploy. Mitigación: disco persistente (1 GB ≈ 0,25 $/mes) o Postgres.

### AWS
Elastic Beanstalk no cobra plataforma; se paga lo que aprovisiona. La propia documentación de AWS estima **≈ 12 $/mes** para un entorno Standard de una sola instancia t3.micro con IP pública y 8 GB gp3, y **≈ 29 $/mes** si se añade un Application Load Balancer. RDS db.t3.micro añade aproximadamente 12-15 $/mes más almacenamiento. Los nuevos accounts tienen 6 meses de Free Tier con créditos que cubren el escenario mínimo.

**Ventaja:** control total y ecosistema maduro. **Inconveniente:** el coste real crece rápido por IP pública, ALB, NAT y RDS; requiere más configuración de seguridad (security groups, IAM).

### Microsoft Azure
App Service ofrece un plan **F1 gratuito** (60 CPU-minutos/día, 1 GB, sin SLA, no recomendado para producción) y el plan **B1 Linux** a **0,018 $/hora ≈ 13,14 $/mes** según Azure Retail Prices API (West Europe). Azure Database for PostgreSQL Flexible Server en SKU burstable **B1ms** (1 vCPU, 2 GiB) ronda los **13-16 $/mes** en la misma región; el SKU se puede parar cuando no se usa.

**Ventaja:** buena integración con GitHub Actions y Entra ID. **Inconveniente:** las tarifas exactas varían mucho por región y los SKUs "burstable" pueden tener créditos de CPU limitados.

### Google Cloud
Cloud Run con facturación por petición incluye cada mes 2 M peticiones, 180.000 vCPU-segundos y 360.000 GiB-segundos gratis; fuera de ahí, 1 vCPU cuesta 0,000024 $/s activo y 1 GiB 0,0000025 $/s (europe-west1, Tarifa 1). El ejemplo oficial con 10 M peticiones, 1 vCPU y 512 MiB cuesta **13,69 $/mes**. Cloud SQL PostgreSQL compartido añade aproximadamente 8-15 $/mes, mientras que mantener SQLite dentro del contenedor sale gratis pero no persiste.

**Ventaja:** escalado a cero: si no hay tráfico, compute ≈ 0. **Inconveniente:** cold starts y coste fijo de Cloud SQL si se quiere persistencia.

## 4. Coste de explotación (no solo infraestructura)

| Proveedor | Tiempo de despliegue | Curva de aprendizaje | Observabilidad incluida | Persistencia sin coste extra |
|---|---|---|---|---|
| Render | Minutos (Blueprint) | Baja | Métricas y logs 7 días (Hobby) | No (disco de pago) |
| AWS | Horas | Alta | CloudWatch (parcialmente gratuito) | Sí, EBS local |
| Azure | Horas | Media-alta | Application Insights (cuota gratuita) | Sí, almacenamiento App Service |
| GCP | Minutos-horas | Media | Cloud Logging/Monitoring (cuota gratuita) | No (Cloud Run efímero) |

## 5. Recomendación

Para **esta entrega académica**, Render es la mejor opción: coste **0 $** con el plan Hobby, despliegue automático desde el repositorio de actividades y HTTPS sin configuración. El blueprint `render.yaml` queda en el repositorio para reproducirlo.

Si el proyecto continuara y el tráfico creciera, la siguiente opción más eficiente económicamente sería **Cloud Run** (paga por petición y escala a cero), seguida de Render con plan de 7 $ más disco. AWS y Azure resultan recomendables solo cuando se necesiten servicios enterprise (VPC avanzada, cumplimiento específico, integración con directorio corporativo), ya que su coste mínimo es superior y exige más trabajo de operación.

## 6. Fuentes

- Render — Pricing: https://render.com/pricing (consultado 19-11-2026)
- Render — Persistent disks: https://render.com/docs/disks (consultado 19-11-2026)
- AWS — Elastic Beanstalk Pricing: https://aws.amazon.com/elasticbeanstalk/pricing/ (consultado 19-11-2026)
- Azure — App Service Linux pricing: https://azure.microsoft.com/en-us/pricing/details/app-service/linux/ y Azure Retail Prices API `https://prices.azure.com/api/retail/prices` (consultado 19-11-2026)
- Azure — PostgreSQL Flexible Server pricing: https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/ (consultado 19-11-2026)
- Google Cloud — Cloud Run pricing: https://cloud.google.com/run/pricing (consultado 19-11-2026)
