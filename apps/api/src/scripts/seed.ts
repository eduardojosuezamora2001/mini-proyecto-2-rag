import "dotenv/config";
import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { syncLocalPolicies } from "../services/ingestion.js";

const departments = ["Operaciones", "Tecnología", "Ventas", "Finanzas", "RRHH"];
const roles = ["Analista", "Especialista", "Coordinador", "Líder"];

await pool.query("TRUNCATE TABLE consultas_chat, reportes_diarios, documentos_vectoriales, notificaciones_colaborador, marcas_asistencia, horarios_laborales, solicitudes, incapacidades, movimientos_personal, saldos_vacaciones, colaboradores CASCADE");

const ids: string[] = [];
const hrId = randomUUID();
await pool.query(
  `INSERT INTO colaboradores (id,nombre,departamento,puesto,fecha_ingreso,rol,estado)
   VALUES ($1,$2,$3,$4,$5,$6,$7)`,
  [hrId, "Camila Herrera", "RRHH", "Gerente de RRHH", "2021-01-15", "rrhh", "activo"],
);
ids.push(hrId);

for (let index = 1; index <= 49; index += 1) {
  const id = randomUUID();
  const department = departments[index % departments.length];
  await pool.query(
    `INSERT INTO colaboradores
      (id,nombre,departamento,puesto,fecha_ingreso,jefe_id,rol,estado,codigo_trabajador)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      `Colaborador Demo ${String(index).padStart(2, "0")}`,
      department,
      `${roles[index % roles.length]} de ${department}`,
      `202${index % 3 + 1}-${String((index % 9) + 1).padStart(2, "0")}-10`,
      hrId,
      "colaborador",
      "activo",
      index <= 5 ? String(10000 + index) : null,
    ],
  );
  ids.push(id);

  if (index <= 5) {
    for (const dayOfWeek of [1, 2, 3, 4, 5]) {
      await pool.query(
        `INSERT INTO horarios_laborales
          (colaborador_id,dia_semana,hora_entrada,hora_salida)
         VALUES ($1,$2,'08:00','17:00')`,
        [id, dayOfWeek],
      );
    }
  }

  const assigned = index === 7 ? 28 : 15 + (index % 8);
  const taken = index % 6;
  await pool.query(
    `INSERT INTO saldos_vacaciones (colaborador_id,periodo,dias_asignados,dias_tomados,dias_disponibles)
     VALUES ($1,2026,$2,$3,$4)`,
    [id, assigned, taken, assigned - taken],
  );
}

const firstId = ids[1];
await pool.query(
  `INSERT INTO solicitudes (colaborador_id,tipo,fecha_inicio,fecha_fin,estado,aprobador_id,creada_en)
   VALUES ($1,'vacaciones',CURRENT_DATE+7,CURRENT_DATE+11,'pendiente',$2,NOW()-INTERVAL '4 days'),
          ($3,'permiso',CURRENT_DATE+2,CURRENT_DATE+2,'aprobada',$2,NOW()-INTERVAL '1 day')`,
  [firstId, hrId, ids[2]],
);

await pool.query(
  `INSERT INTO incapacidades (colaborador_id,tipo,fecha_inicio,dias,entidad)
   VALUES ($1,'enfermedad',CURRENT_DATE-2,4,'Caja Costarricense de Seguro Social')`,
  [ids[3]],
);

for (let index = 0; index < 30; index += 1) {
  const id = ids[index + 1] ?? ids[1];
  await pool.query(
    `INSERT INTO movimientos_personal (colaborador_id,tipo,fecha,motivo)
     VALUES ($1,$2,$3,$4)`,
    [id, index % 7 === 0 ? "ascenso" : index % 11 === 0 ? "salida" : "ingreso", `2026-${String((index % 3) + 8).padStart(2, "0")}-${String((index % 27) + 1).padStart(2, "0")}`, "Dato simulado"],
  );
}

console.log("Datos simulados insertados: 50 colaboradores y movimientos de 3 meses");
const policyIndex = await syncLocalPolicies();
console.log(`Índice local creado: ${policyIndex.indexed} documentos`);
await pool.end();
