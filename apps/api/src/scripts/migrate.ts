import "dotenv/config";
import { pool } from "../db.js";

await pool.query(`
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  CREATE TABLE IF NOT EXISTS colaboradores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    departamento TEXT NOT NULL,
    puesto TEXT NOT NULL,
    fecha_ingreso DATE NOT NULL,
    jefe_id UUID REFERENCES colaboradores(id),
    rol TEXT NOT NULL DEFAULT 'colaborador',
    estado TEXT NOT NULL DEFAULT 'activo'
  );

  ALTER TABLE colaboradores
    ADD COLUMN IF NOT EXISTS codigo_trabajador TEXT;

  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'colaboradores_codigo_trabajador_check'
        AND conrelid = 'colaboradores'::regclass
    ) THEN
      ALTER TABLE colaboradores
        ADD CONSTRAINT colaboradores_codigo_trabajador_check
        CHECK (codigo_trabajador IS NULL OR codigo_trabajador ~ '^[0-9]{5}$');
    END IF;
  END $$;

  CREATE UNIQUE INDEX IF NOT EXISTS colaboradores_codigo_trabajador_idx
    ON colaboradores (codigo_trabajador)
    WHERE codigo_trabajador IS NOT NULL;

  CREATE TABLE IF NOT EXISTS horarios_laborales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colaborador_id UUID NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
    dia_semana SMALLINT NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),
    hora_entrada TIME NOT NULL,
    hora_salida TIME NOT NULL,
    salida_dia_siguiente BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (colaborador_id, dia_semana),
    CHECK (
      (salida_dia_siguiente AND hora_salida <= hora_entrada)
      OR (NOT salida_dia_siguiente AND hora_salida > hora_entrada)
    )
  );

  CREATE TABLE IF NOT EXISTS marcas_asistencia (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colaborador_id UUID NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    hora_entrada TIMESTAMPTZ NOT NULL DEFAULT now(),
    hora_salida TIMESTAMPTZ,
    hora_entrada_programada TIME NOT NULL,
    hora_salida_programada TIME NOT NULL,
    salida_dia_siguiente BOOLEAN NOT NULL DEFAULT false,
    salida_anticipada BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (colaborador_id, fecha),
    CHECK (hora_salida IS NULL OR hora_salida >= hora_entrada),
    CHECK (NOT salida_anticipada OR hora_salida IS NOT NULL)
  );

  CREATE INDEX IF NOT EXISTS marcas_asistencia_fecha_idx
    ON marcas_asistencia (fecha DESC);

  CREATE UNIQUE INDEX IF NOT EXISTS marcas_asistencia_abierta_idx
    ON marcas_asistencia (colaborador_id)
    WHERE hora_salida IS NULL;

  CREATE TABLE IF NOT EXISTS notificaciones_colaborador (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colaborador_id UUID NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
    asistencia_id UUID NOT NULL UNIQUE REFERENCES marcas_asistencia(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo = 'salida_anticipada'),
    titulo TEXT NOT NULL,
    mensaje TEXT NOT NULL,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    leida_en TIMESTAMPTZ
  );

  CREATE INDEX IF NOT EXISTS notificaciones_colaborador_fecha_idx
    ON notificaciones_colaborador (colaborador_id, creada_en DESC);

  CREATE TABLE IF NOT EXISTS saldos_vacaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colaborador_id UUID NOT NULL REFERENCES colaboradores(id),
    periodo INTEGER NOT NULL,
    dias_asignados NUMERIC(5,2) NOT NULL,
    dias_tomados NUMERIC(5,2) NOT NULL DEFAULT 0,
    dias_disponibles NUMERIC(5,2) NOT NULL,
    UNIQUE (colaborador_id, periodo)
  );

  CREATE TABLE IF NOT EXISTS solicitudes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colaborador_id UUID NOT NULL REFERENCES colaboradores(id),
    tipo TEXT NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    estado TEXT NOT NULL,
    aprobador_id UUID REFERENCES colaboradores(id),
    creada_en TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS incapacidades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colaborador_id UUID NOT NULL REFERENCES colaboradores(id),
    tipo TEXT NOT NULL,
    fecha_inicio DATE NOT NULL,
    dias INTEGER NOT NULL,
    entidad TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS movimientos_personal (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colaborador_id UUID NOT NULL REFERENCES colaboradores(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('ingreso','salida','ascenso')),
    fecha DATE NOT NULL,
    motivo TEXT
  );

  CREATE TABLE IF NOT EXISTS consultas_chat (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colaborador_id UUID,
    pregunta TEXT NOT NULL,
    intencion TEXT,
    agente TEXT,
    documentos_citados JSONB NOT NULL DEFAULT '[]',
    resuelta BOOLEAN NOT NULL DEFAULT false,
    escalada BOOLEAN NOT NULL DEFAULT false,
    latencia_ms INTEGER NOT NULL,
    fecha TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS reportes_diarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fecha DATE NOT NULL UNIQUE,
    datos_json JSONB NOT NULL,
    resumen_texto TEXT NOT NULL,
    generado_por TEXT NOT NULL DEFAULT 'agente-analista'
  );

  CREATE TABLE IF NOT EXISTS documentos_vectoriales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drive_file_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    section TEXT,
    version TEXT,
    effective_date TEXT,
    responsible TEXT,
    web_view_link TEXT,
    modified_time TIMESTAMPTZ,
    content_hash TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    embedding vector(768) NOT NULL,
    UNIQUE (drive_file_id, chunk_index)
  );

  CREATE INDEX IF NOT EXISTS documentos_embedding_idx
    ON documentos_vectoriales USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
`);

await pool.end();
console.log("Migración completada");
