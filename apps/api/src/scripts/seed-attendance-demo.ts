import "dotenv/config";
import { pool } from "../db.js";

const accounts = [
  { code: "10001", name: "Colaborador Demo 01", department: "Tecnología", position: "Analista de Tecnología" },
  { code: "10002", name: "Colaborador Demo 02", department: "Ventas", position: "Especialista de Ventas" },
  { code: "10003", name: "Colaborador Demo 03", department: "Finanzas", position: "Coordinador de Finanzas" },
  { code: "10004", name: "Colaborador Demo 04", department: "RRHH", position: "Líder de RRHH" },
  { code: "10005", name: "Colaborador Demo 05", department: "Operaciones", position: "Analista de Operaciones" },
];

const client = await pool.connect();
try {
  await client.query("BEGIN");

  for (const account of accounts) {
    await client.query(
      `INSERT INTO colaboradores
        (nombre,departamento,puesto,fecha_ingreso,rol,estado,codigo_trabajador)
       VALUES ($1,$2,$3,'2024-01-10','colaborador','activo',$4)
       ON CONFLICT DO NOTHING`,
      [account.name, account.department, account.position, account.code],
    );
  }

  const employees = await client.query(
    `SELECT id,codigo_trabajador,nombre,rol,estado
     FROM colaboradores
     WHERE codigo_trabajador = ANY($1::text[])
     ORDER BY codigo_trabajador
     FOR UPDATE`,
    [accounts.map((account) => account.code)],
  );
  if (
    employees.rows.length !== accounts.length ||
    employees.rows.some((employee, index) =>
      employee.nombre !== accounts[index].name ||
      employee.rol !== "colaborador" ||
      employee.estado !== "activo"
    )
  ) {
    throw new Error("Los códigos demo ya pertenecen a cuentas distintas o inactivas; no se modificó ningún registro.");
  }

  const schedules = await client.query(
    `INSERT INTO horarios_laborales
      (colaborador_id,dia_semana,hora_entrada,hora_salida)
     SELECT c.id,days.day,'08:00','17:00'
     FROM colaboradores c
     CROSS JOIN unnest(ARRAY[1,2,3,4,5]::smallint[]) AS days(day)
     WHERE c.codigo_trabajador = ANY($1::text[])
     ON CONFLICT (colaborador_id,dia_semana) DO NOTHING`,
    [accounts.map((account) => account.code)],
  );

  const marks = await client.query(
    `WITH demo_workers AS (
       SELECT id,codigo_trabajador,
         ROW_NUMBER() OVER (ORDER BY codigo_trabajador)::int AS worker_number
       FROM colaboradores
       WHERE codigo_trabajador = ANY($1::text[])
     ),
     work_days AS (
       SELECT days.day::date AS fecha,
         ROW_NUMBER() OVER (ORDER BY days.day)::int AS day_number
       FROM generate_series(
         timezone('America/Costa_Rica', now())::date - 14,
         timezone('America/Costa_Rica', now())::date - 1,
         INTERVAL '1 day'
       ) AS days(day)
       WHERE EXTRACT(ISODOW FROM days.day) BETWEEN 1 AND 5
     )
     INSERT INTO marcas_asistencia
       (colaborador_id,fecha,hora_entrada,hora_salida,hora_entrada_programada,
        hora_salida_programada,salida_dia_siguiente,salida_anticipada)
     SELECT workers.id,work_days.fecha,
       (work_days.fecha + schedule.hora_entrada
         + ((workers.worker_number + work_days.day_number) % 4) * INTERVAL '2 minutes')
         AT TIME ZONE 'America/Costa_Rica',
       (work_days.fecha + schedule.hora_salida
         + CASE WHEN schedule.salida_dia_siguiente THEN INTERVAL '1 day' ELSE INTERVAL '0 day' END
         - CASE WHEN (workers.worker_number + work_days.day_number) % 5 = 0
           THEN INTERVAL '20 minutes' ELSE INTERVAL '0 minutes' END)
         AT TIME ZONE 'America/Costa_Rica',
       schedule.hora_entrada,schedule.hora_salida,schedule.salida_dia_siguiente,
       (workers.worker_number + work_days.day_number) % 5 = 0
     FROM demo_workers workers
     CROSS JOIN work_days
     JOIN horarios_laborales schedule
       ON schedule.colaborador_id=workers.id
       AND schedule.dia_semana=EXTRACT(ISODOW FROM work_days.fecha)::smallint
     ON CONFLICT (colaborador_id,fecha) DO NOTHING`,
    [accounts.map((account) => account.code)],
  );

  const notifications = await client.query(
    `INSERT INTO notificaciones_colaborador
      (colaborador_id,asistencia_id,tipo,titulo,mensaje,creada_en)
     SELECT marks.colaborador_id,marks.id,'salida_anticipada',
       'Salida anterior a tu horario',
       'La salida quedó registrada a las '
         || TO_CHAR(timezone('America/Costa_Rica', marks.hora_salida),'HH24:MI')
         || '; tu horario indica '
         || TO_CHAR(marks.hora_salida_programada,'HH24:MI')
         || '. Este es un aviso de demostración.',
       marks.hora_salida
     FROM marcas_asistencia marks
     WHERE marks.colaborador_id = ANY($1::uuid[])
       AND marks.salida_anticipada
       AND marks.fecha >= timezone('America/Costa_Rica', now())::date - 14
       AND marks.fecha < timezone('America/Costa_Rica', now())::date
     ON CONFLICT (asistencia_id) DO NOTHING`,
    [employees.rows.map((employee) => employee.id)],
  );

  const notificationDates = await client.query(
    `UPDATE notificaciones_colaborador notifications
     SET creada_en=marks.hora_salida
     FROM marcas_asistencia marks
     WHERE notifications.asistencia_id=marks.id
       AND notifications.colaborador_id=marks.colaborador_id
       AND notifications.mensaje LIKE '%Este es un aviso de demostración.'
       AND notifications.creada_en<>marks.hora_salida`,
  );

  await client.query("COMMIT");
  console.log(
    `Datos demo agregados sin borrar registros: ${schedules.rowCount ?? 0} horarios, ` +
    `${marks.rowCount ?? 0} jornadas y ` +
    `${(notifications.rowCount ?? 0) + (notificationDates.rowCount ?? 0)} notificaciones.`,
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
