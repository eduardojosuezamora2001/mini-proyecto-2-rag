import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://portal:portal@localhost:5433/portal_rrhh",
});
