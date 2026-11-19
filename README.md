# Portal RRHH con RAG multiagente

Portal interno construido con React, Express, Node.js, PostgreSQL, pgvector y Google Drive.

## Características

- Chat con consulta directa de políticas.
- Terminal público en `/asistencia` para marcar entrada y salida con código de trabajador; perfil de solo lectura para historial y avisos.
- Datos personales filtrados por el usuario autenticado.
- Consultas mixtas de datos y políticas.
- Rechazo de consultas restringidas.
- Ingesta desde Google Drive con PDF, DOCX, Google Docs, Sheets y CSV.
- Embeddings Gemini configurables y respaldo determinista local.
- Chat con DeepSeek mediante API compatible OpenAI.
- Reporte diario a las 7:00 y sincronización de Drive a las 3:00.
- Reportes de RRHH con tendencia de asistencia de 30 días e historial de reportes.
- Dashboard exclusivo para el rol RRHH.
- Servicios especializados sin orquestador LLM separado.

## Requisitos

- Node.js 20.19 o superior.
- pnpm 11.
- Docker Desktop.
- Cuenta de servicio de Google Drive.
- Carpeta compartida con la cuenta de servicio.
- API key de DeepSeek opcional.
- API key de Gemini opcional para embeddings.

## Inicio rápido

```powershell
pnpm install
docker compose up -d
copy .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm dev
```

La API queda en `http://localhost:3001` y React en `http://localhost:5173`.

## Google Drive

1. Crear o reutilizar un proyecto de Google Cloud.
2. Activar Google Drive API.
3. Crear una cuenta de servicio.
4. Compartir la carpeta con el correo de la cuenta de servicio.
5. Configurar una de estas opciones:
   - `GOOGLE_SERVICE_ACCOUNT_JSON=./service-account.json`
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
6. Configurar `GOOGLE_DRIVE_FOLDER_ID=1TyDNmNDUcPtUeuhvDwLE5tk75bSbVSel`.

La cuenta de servicio necesita permiso de editor en la carpeta configurada para que RRHH pueda subir y eliminar archivos. El portal limita estas acciones al rol RRHH y trabaja únicamente con documentos que estén directamente dentro de esa carpeta.

## Variables de entorno

Copiar `.env.example` a `.env` y completar:

- `DATABASE_URL`
- `JWT_SECRET`
- `GOOGLE_DRIVE_FOLDER_ID`
- Credenciales de Google.
- `DEEPSEEK_API_KEY`
- `GEMINI_API_KEY`

No se deben añadir credenciales al repositorio.

## Base de datos

```powershell
pnpm db:migrate
pnpm db:seed
```

La migración agrega horarios, marcas de asistencia y notificaciones. La semilla crea 50 colaboradores, tres meses de movimientos, solicitudes, incapacidades y saldos, además de cinco cuentas de prueba de colaborador con horario de lunes a viernes de 08:00 a 17:00.

> **Atención:** `pnpm db:seed` trunca y vuelve a crear los datos de demostración. No lo ejecutes sobre una base con datos que deban conservarse.

Para agregar únicamente cuentas y jornadas de demostración sin truncar tablas, ejecuta `pnpm --filter api db:seed:attendance-demo`. El proceso crea historial reciente y avisos de salida anticipada; si los códigos demo existentes pertenecen a cuentas distintas o inactivas, aborta sin modificar datos.

Los códigos de prueba son `10001`, `10002`, `10003`, `10004` y `10005`. Son códigos simulados para desarrollo; el acceso de RRHH de demostración sigue disponible por separado. No uses códigos de cinco dígitos como único factor de autenticación en producción.

Las marcas se registran en `/asistencia`: el código inicia una jornada si no hay una abierta y registra la salida si ya existe una. El perfil del colaborador solo permite consultar el historial y los avisos. Las marcas usan la hora del servidor y la zona horaria `America/Costa_Rica`. Las salidas anteriores al horario programado generan una notificación persistente en la cuenta del colaborador. Esto no configura correo ni notificaciones push cuando la aplicación está cerrada.

## Sincronizar Drive

Con un token RRHH:

```text
POST /api/ingest/sync
Authorization: Bearer <token-rrhh>
```

También se ejecuta automáticamente cada día a las 3:00.

## Administración de documentos

El rol RRHH puede abrir **Documentos** en el portal para listar los archivos de Drive, leer su contenido, subir archivos PDF, DOCX, TXT, CSV, XLS o XLSX de hasta 15 MB y eliminarlos permanentemente. Al subir un archivo, el portal inicia su sincronización e indexación; la eliminación también borra sus fragmentos indexados.

La API protege estas operaciones con autenticación y autorización de RRHH. La clave de servicio debe tener acceso de editor a la carpeta. La eliminación es permanente.

## Sesiones demo

- Colaborador: `POST /api/auth/demo/colaborador`
- RRHH: `POST /api/auth/demo/rrhh`

## Reportes

- Generación manual RRHH: `POST /api/reports/generate`
- Generación automática: todos los días a las 7:00.
- Historial: `GET /api/reports`
- Dashboard: `GET /api/dashboard`

Las cifras se consultan con SQL y el LLM solo redacta el resumen.

## Documentación

- Investigación: `docs/INVESTIGACION_COSTA_RICA.md`
- Políticas: `docs/politicas`
- Arquitectura: `docs/arquitectura.md`
- Hoja de evaluación: `docs/evaluacion-45-preguntas.csv`
- PDF y hoja de calendario: ejecutar `pnpm --filter api docs:generate`
