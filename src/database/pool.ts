import pg from "pg";

import { env } from "../config/env.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
});

export async function checkDatabaseConnection() {
  await pool.query("SELECT 1");
}

export async function closeDatabase() {
  await pool.end();
}
