import { pool } from "../db.js";
import { completeText } from "./llm.js";

function getCostaRicaDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function generateDailyReport(date = new Date()) {
  const isoDate = getCostaRicaDate(date);
  const [
    absences,
    pending,
    incapacities,
    movements,
    vacationRisk,
    chat,
    topTopics,
    unresolved,
    attendanceToday,
    attendanceTrend,
  ] = await Promise.all([
    pool.query(`
      SELECT departamento,
        COUNT(*) FILTER (WHERE s.tipo='vacaciones') AS vacaciones,
        COUNT(*) FILTER (WHERE s.tipo='permiso') AS permisos
      FROM colaboradores c
      LEFT JOIN solicitudes s ON s.colaborador_id=c.id
        AND s.estado='aprobada' AND $1::date BETWEEN s.fecha_inicio AND s.fecha_fin
      GROUP BY departamento ORDER BY departamento
    `, [isoDate]),
    pool.query(`
      SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE creada_en < NOW()-INTERVAL '3 days') AS older_than_three_days
      FROM solicitudes WHERE estado='pendiente'
    `),
    pool.query(`
      SELECT COUNT(*) AS active_count, COALESCE(SUM(dias),0) AS accumulated_days
      FROM incapacidades
      WHERE fecha_inicio >= DATE_TRUNC('month',$1::date)
        AND fecha_inicio <= $1::date
    `, [isoDate]),
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE tipo='ingreso') AS ingresos,
        COUNT(*) FILTER (WHERE tipo='salida') AS salidas,
        COUNT(*) FILTER (WHERE tipo='ascenso') AS ascensos
      FROM movimientos_personal
      WHERE fecha >= DATE_TRUNC('month',$1::date) AND fecha <= $1::date
    `, [isoDate]),
    pool.query(`
      SELECT nombre, departamento, dias_disponibles
      FROM colaboradores c
      JOIN saldos_vacaciones s ON s.colaborador_id=c.id
      WHERE s.dias_asignados-s.dias_tomados > 20
      ORDER BY s.dias_disponibles DESC
    `),
    pool.query(`
      SELECT COUNT(*) AS consultas,
        COALESCE(AVG(latencia_ms),0)::int AS average_latency,
        COALESCE(100.0*COUNT(*) FILTER (WHERE resuelta AND NOT escalada)/NULLIF(COUNT(*),0),0)::int AS resolved_percentage
      FROM consultas_chat
      WHERE fecha >= $1::date-INTERVAL '1 day' AND fecha < $1::date
    `, [isoDate]),
    pool.query(`
      SELECT COALESCE(intencion,'sin_clasificar') AS topic, COUNT(*) AS count
      FROM consultas_chat
      WHERE fecha >= $1::date-INTERVAL '1 day' AND fecha < $1::date
      GROUP BY intencion ORDER BY count DESC LIMIT 5
    `, [isoDate]),
    pool.query(`
      SELECT DISTINCT pregunta
      FROM consultas_chat
      WHERE fecha >= $1::date-INTERVAL '1 day' AND fecha < $1::date
        AND (escalada OR NOT resuelta)
      LIMIT 20
    `, [isoDate]),
    pool.query(`
      SELECT
        COUNT(*)::int AS marcas,
        COUNT(DISTINCT colaborador_id)::int AS colaboradores,
        COUNT(*) FILTER (WHERE hora_salida IS NOT NULL)::int AS jornadas_completas,
        COUNT(*) FILTER (WHERE salida_anticipada)::int AS salidas_anticipadas,
        COUNT(*) FILTER (WHERE hora_salida IS NULL)::int AS sin_marca_salida
      FROM marcas_asistencia
      WHERE fecha=$1::date
    `, [isoDate]),
    pool.query(`
      SELECT days.fecha::date AS fecha,
        COUNT(m.id)::int AS marcas,
        COUNT(m.id) FILTER (WHERE m.salida_anticipada)::int AS salidas_anticipadas
      FROM generate_series($1::date - INTERVAL '29 days', $1::date, INTERVAL '1 day') AS days(fecha)
      LEFT JOIN marcas_asistencia m ON m.fecha=days.fecha::date
      GROUP BY days.fecha
      ORDER BY days.fecha
    `, [isoDate]),
  ]);

  const employees = await pool.query("SELECT COUNT(*)::int AS total FROM colaboradores");
  const exits = Number(movements.rows[0]?.salidas ?? 0);
  const rotations = employees.rows[0].total
    ? Number((exits / employees.rows[0].total * 100).toFixed(2))
    : 0;

  const data = {
    fecha: isoDate,
    ausencias_hoy: absences.rows,
    solicitudes_pendientes: pending.rows[0],
    incapacidades: incapacities.rows[0],
    movimientos_mes: movements.rows[0],
    tasa_rotacion_acumulada: rotations,
    riesgo_vacaciones: vacationRisk.rows,
    uso_chat: chat.rows[0],
    top_5_temas: topTopics.rows,
    preguntas_sin_respuesta: unresolved.rows.map((row) => row.pregunta),
    asistencia_hoy: attendanceToday.rows[0],
    tendencia_asistencia_30_dias: attendanceTrend.rows,
  };

  const summary = await completeText(
    "Eres un analista de RRHH. Redacta de 3 a 5 frases en español usando exclusivamente las cifras del JSON. No añadas números ni conclusiones sin respaldo.",
    JSON.stringify(data),
  );
  const fallback = `Se procesó el reporte del ${isoDate}. Hay ${pending.rows[0].total} solicitudes pendientes y ${vacationRisk.rows.length} colaboradores con posible riesgo de vacaciones acumuladas. La actividad del chatbot registró ${chat.rows[0].consultas} consultas. Se registraron ${attendanceToday.rows[0].marcas} marcas de asistencia y ${attendanceToday.rows[0].salidas_anticipadas} salidas anticipadas.`;

  await pool.query(
    `INSERT INTO reportes_diarios (fecha,datos_json,resumen_texto,generado_por)
     VALUES ($1,$2,$3,'agente-analista')
     ON CONFLICT (fecha) DO UPDATE SET datos_json=EXCLUDED.datos_json,resumen_texto=EXCLUDED.resumen_texto`,
    [isoDate, JSON.stringify(data), summary || fallback],
  );

  return { ...data, resumen_texto: summary || fallback };
}
