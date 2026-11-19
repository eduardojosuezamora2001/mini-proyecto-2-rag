import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import cron from "node-cron";
import path from "node:path";
import { z } from "zod";
import { pool } from "./db.js";
import { config } from "./config.js";
import { searchPolicy } from "./services/rag.js";
import { syncDrive } from "./services/ingestion.js";
import {
  deleteDriveDocument,
  getDriveDocument,
  listDriveDocuments,
  uploadDriveDocument,
} from "./services/drive.js";
import { generateDailyReport } from "./services/report.js";

type AuthPayload = {
  sub: string;
  role: "colaborador" | "rrhh";
  name: string;
};

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) {
    res.status(401).json({ error: "Inicia sesión para continuar." });
    return;
  }
  try {
    req.auth = jwt.verify(token, config.jwtSecret) as AuthPayload;
    next();
  } catch {
    res.status(401).json({ error: "Sesión inválida o vencida." });
  }
}

function requireRrhh(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.auth?.role !== "rrhh") {
    res.status(403).json({ error: "Solo RRHH puede administrar documentos." });
    return;
  }
  next();
}

function requireCollaborator(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.auth?.role !== "colaborador") {
    res.status(403).json({ error: "Esta acción está disponible para cuentas de colaborador." });
    return;
  }
  next();
}

const uploadMimeTypes: Record<string, string> = {
  ".csv": "text/csv",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "portal-rrhh-api" });
});

app.post("/api/auth/demo/:role", async (req, res, next) => {
  try {
    const role = req.params.role === "rrhh" ? "rrhh" : "colaborador";
    const result = await pool.query(
      "SELECT id,nombre,rol FROM colaboradores WHERE rol=$1 ORDER BY nombre LIMIT 1",
      [role],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Ejecute las semillas de datos antes de iniciar sesión." });
      return;
    }
    const employee = result.rows[0];
    const token = jwt.sign(
      { sub: employee.id, role: employee.rol, name: employee.nombre },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn } as jwt.SignOptions,
    );
    res.json({ token, user: { id: employee.id, name: employee.nombre, role: employee.rol } });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/employee-code", async (req, res, next) => {
  try {
    const body = z.object({ code: z.string().regex(/^\d{5}$/) }).parse(req.body);
    const result = await pool.query(
      `SELECT id,nombre,rol FROM colaboradores
       WHERE codigo_trabajador=$1 AND estado='activo'
       LIMIT 1`,
      [body.code],
    );
    const employee = result.rows[0];
    if (!employee || (employee.rol !== "colaborador" && employee.rol !== "rrhh")) {
      res.status(401).json({ error: "El código no es válido o la cuenta no está activa." });
      return;
    }

    const token = jwt.sign(
      { sub: employee.id, role: employee.rol, name: employee.nombre },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn } as jwt.SignOptions,
    );
    res.json({
      token,
      user: { id: employee.id, name: employee.nombre, role: employee.rol },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/me", authMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id,nombre AS name,departamento,puesto,fecha_ingreso,rol AS role,estado FROM colaboradores WHERE id=$1",
      [req.auth?.sub],
    );
    res.json(result.rows[0] ?? null);
  } catch (error) {
    next(error);
  }
});

app.get("/api/attendance/me", authMiddleware, requireCollaborator, async (req, res, next) => {
  try {
    const employeeId = req.auth?.sub;
    const [schedule, today, active, history, notifications] = await Promise.all([
      pool.query(
        `SELECT h.dia_semana,h.hora_entrada,h.hora_salida,h.salida_dia_siguiente
         FROM horarios_laborales h
         WHERE h.colaborador_id=$1
           AND h.dia_semana=EXTRACT(ISODOW FROM timezone('America/Costa_Rica', now()))::smallint`,
        [employeeId],
      ),
      pool.query(
        `SELECT *,
           timezone('America/Costa_Rica', hora_entrada)::time AS hora_entrada_local,
           CASE WHEN hora_salida IS NULL THEN NULL
             ELSE timezone('America/Costa_Rica', hora_salida)::time
           END AS hora_salida_local
         FROM marcas_asistencia
         WHERE colaborador_id=$1
           AND fecha=timezone('America/Costa_Rica', now())::date`,
        [employeeId],
      ),
      pool.query(
        `SELECT *,
           timezone('America/Costa_Rica', hora_entrada)::time AS hora_entrada_local
         FROM marcas_asistencia
         WHERE colaborador_id=$1 AND hora_salida IS NULL
         ORDER BY fecha DESC LIMIT 1`,
        [employeeId],
      ),
      pool.query(
        `SELECT id,fecha,hora_entrada,hora_salida,hora_entrada_programada,
           hora_salida_programada,salida_dia_siguiente,salida_anticipada,
           timezone('America/Costa_Rica', hora_entrada)::time AS hora_entrada_local,
           CASE WHEN hora_salida IS NULL THEN NULL
             ELSE timezone('America/Costa_Rica', hora_salida)::time
           END AS hora_salida_local
         FROM marcas_asistencia
         WHERE colaborador_id=$1
           AND fecha >= timezone('America/Costa_Rica', now())::date - 29
         ORDER BY fecha DESC LIMIT 30`,
        [employeeId],
      ),
      pool.query(
        `SELECT id,titulo,mensaje,creada_en,leida_en
         FROM notificaciones_colaborador
         WHERE colaborador_id=$1
         ORDER BY creada_en DESC LIMIT 20`,
        [employeeId],
      ),
    ]);

    res.json({
      schedule: schedule.rows[0] ?? null,
      today: today.rows[0] ?? null,
      active: active.rows[0] ?? null,
      history: history.rows,
      notifications: notifications.rows,
    });
  } catch (error) {
    next(error);
  }
});

class AttendanceActionError extends Error {}

const kioskAttempts = new Map<string, { count: number; resetAt: number }>();

function limitAttendanceKiosk(req: express.Request, res: express.Response, next: express.NextFunction) {
  const now = Date.now();
  const address = req.ip || req.socket.remoteAddress || "unknown";
  let window = kioskAttempts.get(address);

  if (!window || window.resetAt <= now) {
    window = { count: 0, resetAt: now + 60_000 };
    kioskAttempts.set(address, window);
  }
  if (kioskAttempts.size > 1000) {
    for (const [key, attempt] of kioskAttempts) {
      if (attempt.resetAt <= now || kioskAttempts.size > 1000) kioskAttempts.delete(key);
    }
  }
  if (window.count >= 30) {
    res.setHeader("Retry-After", Math.ceil((window.resetAt - now) / 1000));
    res.status(429).json({ error: "Se alcanzó el límite de marcaciones. Espera un minuto e inténtalo de nuevo." });
    return;
  }

  window.count += 1;
  next();
}

async function registerCheckIn(employeeId: string): Promise<Record<string, unknown>> {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT id FROM colaboradores WHERE id=$1 FOR UPDATE", [employeeId]);

    const schedule = await client.query(
      `SELECT h.hora_entrada,h.hora_salida,h.salida_dia_siguiente
       FROM horarios_laborales h
       WHERE h.colaborador_id=$1
         AND h.dia_semana=EXTRACT(ISODOW FROM timezone('America/Costa_Rica', now()))::smallint`,
      [employeeId],
    );
    if (!schedule.rows[0]) {
      throw new AttendanceActionError("No tienes un horario programado para hoy. Contacta a RRHH.");
    }

    const openMark = await client.query(
      "SELECT id FROM marcas_asistencia WHERE colaborador_id=$1 AND hora_salida IS NULL LIMIT 1",
      [employeeId],
    );
    if (openMark.rows[0]) {
      throw new AttendanceActionError("Ya tienes una jornada abierta. Registra la salida antes de iniciar otra.");
    }

    const mark = await client.query(
      `INSERT INTO marcas_asistencia
        (colaborador_id,fecha,hora_entrada,hora_entrada_programada,
         hora_salida_programada,salida_dia_siguiente)
       SELECT $1,timezone('America/Costa_Rica', now())::date,now(),$2,$3,$4
       ON CONFLICT DO NOTHING
       RETURNING id,fecha,hora_entrada,hora_entrada_programada,
         hora_salida_programada,salida_dia_siguiente`,
      [
        employeeId,
        schedule.rows[0].hora_entrada,
        schedule.rows[0].hora_salida,
        schedule.rows[0].salida_dia_siguiente,
      ],
    );
    if (!mark.rows[0]) {
      throw new AttendanceActionError("Ya existe una marca de entrada para hoy.");
    }

    await client.query("COMMIT");
    transactionStarted = false;
    return mark.rows[0];
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function registerCheckOut(employeeId: string): Promise<{
  mark: Record<string, unknown>;
  notification: Record<string, unknown> | null;
}> {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const openMark = await client.query(
      `SELECT id FROM marcas_asistencia
       WHERE colaborador_id=$1 AND hora_salida IS NULL
       ORDER BY fecha DESC LIMIT 1 FOR UPDATE`,
      [employeeId],
    );
    if (!openMark.rows[0]) {
      throw new AttendanceActionError("No hay una jornada abierta para registrar la salida.");
    }

    const result = await client.query(
      `UPDATE marcas_asistencia
       SET hora_salida=now(),
           salida_anticipada=now() < (
             (fecha + hora_salida_programada
               + CASE WHEN salida_dia_siguiente THEN INTERVAL '1 day' ELSE INTERVAL '0 day' END)
             AT TIME ZONE 'America/Costa_Rica'
           )
       WHERE id=$1
       RETURNING id,fecha,hora_entrada,hora_salida,hora_entrada_programada,
         hora_salida_programada,salida_dia_siguiente,salida_anticipada,
         timezone('America/Costa_Rica', hora_entrada)::time AS hora_entrada_local,
         timezone('America/Costa_Rica', hora_salida)::time AS hora_salida_local`,
      [openMark.rows[0].id],
    );
    const mark = result.rows[0];
    let notification: Record<string, unknown> | null = null;
    if (mark.salida_anticipada) {
      const scheduledTime = String(mark.hora_salida_programada).slice(0, 5);
      const actualTime = String(mark.hora_salida_local).slice(0, 5);
      const title = "Salida anterior a tu horario";
      const message = `La salida quedó registrada a las ${actualTime}; tu horario indica ${scheduledTime}. Si tienes un permiso, un ajuste aprobado o hubo un error de marcación, comunícalo a tu jefatura.`;
      const created = await client.query(
        `INSERT INTO notificaciones_colaborador
          (colaborador_id,asistencia_id,tipo,titulo,mensaje)
         VALUES ($1,$2,'salida_anticipada',$3,$4)
         RETURNING id,titulo,mensaje,creada_en,leida_en`,
        [employeeId, mark.id, title, message],
      );
      notification = created.rows[0];
    }

    await client.query("COMMIT");
    transactionStarted = false;
    return { mark, notification };
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

app.post("/api/attendance/kiosk", limitAttendanceKiosk, async (req, res, next) => {
  try {
    const body = z.object({ code: z.string().regex(/^\d{5}$/) }).parse(req.body);
    const employee = await pool.query(
      `SELECT id FROM colaboradores
       WHERE codigo_trabajador=$1 AND estado='activo' AND rol='colaborador'
       LIMIT 1`,
      [body.code],
    );
    if (!employee.rows[0]) {
      res.status(401).json({ error: "El código no es válido o la cuenta no está activa." });
      return;
    }

    const employeeId = String(employee.rows[0].id);
    const openMark = await pool.query(
      "SELECT id FROM marcas_asistencia WHERE colaborador_id=$1 AND hora_salida IS NULL LIMIT 1",
      [employeeId],
    );
    if (openMark.rows[0]) {
      const result = await registerCheckOut(employeeId);
      res.json({ action: "check-out", ...result });
    } else {
      const mark = await registerCheckIn(employeeId);
      res.status(201).json({ action: "check-in", mark });
    }
  } catch (error) {
    if (error instanceof AttendanceActionError) {
      res.status(409).json({ error: error.message });
      return;
    }
    next(error);
  }
});

app.post("/api/attendance/check-in", authMiddleware, requireCollaborator, async (req, res, next) => {
  try {
    const employeeId = req.auth?.sub;
    if (!employeeId) {
      res.status(401).json({ error: "Inicia sesión para continuar." });
      return;
    }
    const mark = await registerCheckIn(employeeId);
    res.status(201).json(mark);
  } catch (error) {
    if (error instanceof AttendanceActionError) {
      res.status(409).json({ error: error.message });
      return;
    }
    next(error);
  }
});

app.post("/api/attendance/check-out", authMiddleware, requireCollaborator, async (req, res, next) => {
  try {
    const employeeId = req.auth?.sub;
    if (!employeeId) {
      res.status(401).json({ error: "Inicia sesión para continuar." });
      return;
    }
    const result = await registerCheckOut(employeeId);
    res.json(result);
  } catch (error) {
    if (error instanceof AttendanceActionError) {
      res.status(409).json({ error: error.message });
      return;
    }
    next(error);
  }
});

async function employeeDataQuestion(userId: string, question: string) {
  const lower = question.toLowerCase();
  if (lower.includes("vacacion") || lower.includes("vacaciones")) {
    const result = await pool.query(
      "SELECT dias_asignados,dias_tomados,dias_disponibles,periodo FROM saldos_vacaciones WHERE colaborador_id=$1 ORDER BY periodo DESC LIMIT 1",
      [userId],
    );
    if (result.rows[0]) {
      return `Tienes ${result.rows[0].dias_disponibles} días de vacaciones disponibles para el periodo ${result.rows[0].periodo}.`;
    }
  }
  if (lower.includes("solicitud") || lower.includes("permiso")) {
    const result = await pool.query(
      `SELECT tipo,fecha_inicio,fecha_fin,estado FROM solicitudes
       WHERE colaborador_id=$1 ORDER BY creada_en DESC LIMIT 1`,
      [userId],
    );
    if (result.rows[0]) {
      const row = result.rows[0];
      return `Tu solicitud de ${row.tipo}, del ${row.fecha_inicio.toISOString().slice(0, 10)} al ${row.fecha_fin.toISOString().slice(0, 10)}, está ${row.estado}.`;
    }
  }
  if (lower.includes("pago") || lower.includes("planilla") || lower.includes("aguinaldo")) {
    return "Tu próxima fecha de pago debe consultarse en el calendario salarial vigente. La regla general de pago aparece en la política laboral.";
  }
  if (lower.includes("evaluacion") || lower.includes("evaluación")) {
    return "No hay una fecha de evaluación registrada para tu perfil en los datos simulados disponibles.";
  }
  return "No encontré un dato personal asociado a esa consulta.";
}

app.post("/api/chat", authMiddleware, async (req, res, next) => {
  const started = Date.now();
  try {
    const body = z.object({ message: z.string().trim().min(1).max(2000) }).parse(req.body);
    const question = body.message;
    const lower = question.toLowerCase();
    const restricted =
      /compañero|compañera|salario.*(?:gerente|direct|jefe)|vacaciones.*(?:juan|maria|maría)/i.test(question);
    const movie = /película|pelicula|serie|cine/i.test(question);
    const personal = /me quedan|mis vacaciones|mi próximo|mi próxima|mi solicitud|mi evaluación|mi evaluacion|cuánto me|cuanto me/i.test(question);
    const policy = /vacaciones|permiso|licencia|incapacidad|trabajar desde casa|teletrabajo|horas extra|periodo de prueba|renuncio|liquidación|liquidacion|seguro médico|seguro medico|acoso|feriado|aguinaldo|acumular/i.test(question);
    const aggregate = /cuántas personas|cuantas personas|ausencias hoy|vacaciones hoy/i.test(question);

    let answer = "";
    let citations: unknown[] = [];
    let agents = "";
    let resolved = true;
    let escalated = false;
    let sourceLabel = "No se consultaron fuentes.";

    if (restricted && req.auth?.role !== "rrhh") {
      answer = "No puedo mostrar datos personales de otro colaborador. Solo puedes consultar tus propios datos o solicitar que RRHH entregue información agregada.";
      agents = "restricción";
      sourceLabel = "No se consultaron datos personales por privacidad.";
      resolved = false;
    } else if (movie) {
      answer = "Puedo ayudarte con temas de RRHH. ¿Quieres consultar vacaciones, permisos, incapacidades o beneficios?";
      agents = "fuera-de-alcance";
      sourceLabel = "No se consultaron fuentes.";
      resolved = false;
    } else if (aggregate && req.auth?.role === "rrhh") {
      const report = await generateDailyReport();
      answer = `Hoy hay ${report.ausencias_hoy.reduce((sum: number, row: { vacaciones: string }) => sum + Number(row.vacaciones), 0)} personas registradas de vacaciones y ${report.ausencias_hoy.reduce((sum: number, row: { permisos: string }) => sum + Number(row.permisos), 0)} con permiso en el reporte diario.`;
      agents = "datos-agregados";
      sourceLabel = "Reportes internos y datos agregados del portal.";
    } else if (personal && policy) {
      const [data, rag] = await Promise.all([
        employeeDataQuestion(req.auth?.sub ?? "", question),
        searchPolicy(question),
      ]);
      answer = `${data}\n\n${rag.answer}`;
      citations = rag.citations;
      agents = "datos-del-colaborador+políticas";
      sourceLabel = "Datos personales del portal y documentos de políticas de RRHH.";
      resolved = rag.resolved;
    } else if (personal) {
      answer = await employeeDataQuestion(req.auth?.sub ?? "", question);
      agents = "datos-del-colaborador";
      sourceLabel = "Perfil y solicitudes del colaborador en el portal.";
      resolved = !answer.startsWith("No encontré");
    } else if (policy) {
      const rag = await searchPolicy(question);
      answer = rag.answer;
      citations = rag.citations;
      agents = "políticas-rag";
      sourceLabel = rag.citations.length ? "Documentos de políticas de RRHH." : "No se encontraron documentos de respaldo.";
      resolved = rag.resolved;
      escalated = !rag.resolved;
    } else {
      const rag = await searchPolicy(question);
      answer = rag.resolved
        ? rag.answer
        : "No encontré información suficiente en los documentos de RRHH. Puedo derivarte a una persona del área.";
      citations = rag.citations;
      agents = "políticas-rag";
      sourceLabel = rag.citations.length ? "Documentos de políticas de RRHH." : "No se encontraron documentos de respaldo.";
      resolved = rag.resolved;
      escalated = !rag.resolved;
    }

    const latency = Date.now() - started;
    await pool.query(
      `INSERT INTO consultas_chat
        (colaborador_id,pregunta,intencion,agente,documentos_citados,resuelta,escalada,latencia_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [req.auth?.sub, question, agents, agents, JSON.stringify(citations), resolved, escalated, latency],
    );

    res.json({ answer, citations, source_label: sourceLabel, agents, resolved, escalated, latency_ms: latency });
  } catch (error) {
    next(error);
  }
});

app.post("/api/ingest/sync", authMiddleware, async (req, res, next) => {
  if (req.auth?.role !== "rrhh") {
    res.status(403).json({ error: "Solo RRHH puede iniciar la sincronización." });
    return;
  }
  try {
    res.json(await syncDrive());
  } catch (error) {
    next(error);
  }
});

app.get("/api/drive/documents", authMiddleware, requireRrhh, async (_req, res, next) => {
  try {
    res.json(await listDriveDocuments());
  } catch (error) {
    next(error);
  }
});

app.get("/api/drive/documents/:id", authMiddleware, requireRrhh, async (req, res, next) => {
  const { id } = req.params;
  if (typeof id !== "string") {
    res.status(400).json({ error: "El identificador del documento no es válido." });
    return;
  }
  try {
    const document = await getDriveDocument(id);
    if (!document) {
      res.status(404).json({ error: "No se encontró el documento en la carpeta configurada." });
      return;
    }
    res.json(document);
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/drive/documents",
  authMiddleware,
  requireRrhh,
  express.raw({ type: "application/octet-stream", limit: "15mb" }),
  async (req, res, next) => {
    const requestedName = typeof req.query.name === "string" ? req.query.name : "";
    const name = requestedName.split(/[\\/]/).pop()?.trim() ?? "";
    const mimeType = uploadMimeTypes[path.extname(name).toLowerCase()];
    if (!name || name.length > 255) {
      res.status(400).json({ error: "El nombre del archivo no es válido." });
      return;
    }
    if (!mimeType) {
      res.status(415).json({ error: "Formato no admitido. Sube PDF, DOCX, MD, TXT, CSV, XLS o XLSX." });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "El archivo está vacío o no se pudo leer." });
      return;
    }

    try {
      res.status(201).json(await uploadDriveDocument(name, mimeType, req.body));
    } catch (error) {
      next(error);
    }
  },
);

app.delete("/api/drive/documents/:id", authMiddleware, requireRrhh, async (req, res, next) => {
  const { id } = req.params;
  if (typeof id !== "string") {
    res.status(400).json({ error: "El identificador del documento no es válido." });
    return;
  }
  try {
    const deleted = await deleteDriveDocument(id);
    if (!deleted) {
      res.status(404).json({ error: "No se encontró el documento en la carpeta configurada." });
      return;
    }
    await pool.query("DELETE FROM documentos_vectoriales WHERE drive_file_id=$1", [id]);
    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/reports/generate", authMiddleware, async (req, res, next) => {
  if (req.auth?.role !== "rrhh") {
    res.status(403).json({ error: "Solo RRHH puede generar reportes." });
    return;
  }
  try {
    res.json(await generateDailyReport());
  } catch (error) {
    next(error);
  }
});

app.get("/api/reports", authMiddleware, async (req, res, next) => {
  if (req.auth?.role !== "rrhh") {
    res.status(403).json({ error: "Solo RRHH puede consultar el dashboard." });
    return;
  }
  try {
    const latest = await pool.query(
      "SELECT id,fecha,datos_json,resumen_texto,generado_por FROM reportes_diarios ORDER BY fecha DESC LIMIT 30",
    );
    res.json(latest.rows);
  } catch (error) {
    next(error);
  }
});

app.get("/api/dashboard", authMiddleware, async (req, res, next) => {
  if (req.auth?.role !== "rrhh") {
    res.status(403).json({ error: "Solo RRHH puede consultar el dashboard." });
    return;
  }
  try {
    const [pending, chat, latest] = await Promise.all([
      pool.query(`SELECT s.id,c.nombre,c.departamento,s.tipo,s.fecha_inicio,s.fecha_fin,s.estado,s.creada_en
                  FROM solicitudes s JOIN colaboradores c ON c.id=s.colaborador_id
                  WHERE s.estado='pendiente' ORDER BY s.creada_en DESC LIMIT 50`),
      pool.query(`SELECT COUNT(*)::int AS consultas,
                         COALESCE(AVG(latencia_ms),0)::int AS latencia_promedio,
                         COALESCE(100.0*COUNT(*) FILTER (WHERE resuelta AND NOT escalada)/NULLIF(COUNT(*),0),0)::int AS resueltas
                  FROM consultas_chat`),
      pool.query("SELECT * FROM reportes_diarios ORDER BY fecha DESC LIMIT 1"),
    ]);
    res.json({
      solicitudes_pendientes: pending.rows,
      uso_chat: chat.rows[0],
      reporte_reciente: latest.rows[0] ?? null,
    });
  } catch (error) {
    next(error);
  }
});

cron.schedule("0 7 * * *", async () => {
  try {
    await generateDailyReport();
    console.log("Reporte diario generado");
  } catch (error) {
    console.error("Error generando reporte diario", error);
  }
}, { timezone: "America/Costa_Rica" });

cron.schedule("0 3 * * *", async () => {
  try {
    await syncDrive();
    console.log("Sincronización diaria con Drive completada");
  } catch (error) {
    console.error("Error sincronizando Drive", error);
  }
}, { timezone: "America/Costa_Rica" });

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(400).json({ error: error instanceof Error ? error.message : "Error inesperado" });
});

app.listen(config.port, () => {
  console.log(`API escuchando en http://localhost:${config.port}`);
});
