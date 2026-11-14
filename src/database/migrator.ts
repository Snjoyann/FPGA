import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { env } from "../config/env.js";

const { Client } = pg;
const migrationsDirectory = fileURLToPath(new URL("../../database/migrations/", import.meta.url));
const migrationFilePattern = /^\d{3,}_[a-z0-9_-]+\.sql$/i;
const migrationLockId = 2_026_111_400;

type AppliedMigration = {
  name: string;
  checksum: string;
};

export async function migrateDatabase(): Promise<{ applied: string[] }> {
  const client = new Client({ connectionString: env.databaseDirectUrl });
  const applied: string[] = [];
  let lockAcquired = false;

  await client.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [migrationLockId]);
    lockAcquired = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const files = (await readdir(migrationsDirectory))
      .filter((file) => migrationFilePattern.test(file))
      .sort((left, right) => left.localeCompare(right));

    const result = await client.query<AppliedMigration>(
      "SELECT name, checksum FROM schema_migrations ORDER BY name",
    );
    const completed = new Map(result.rows.map((migration) => [migration.name, migration.checksum]));

    for (const file of files) {
      const sql = await readFile(`${migrationsDirectory}/${file}`, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existingChecksum = completed.get(file);

      if (existingChecksum) {
        if (existingChecksum !== checksum) {
          throw new Error(`Migration ${file} was changed after it was applied.`);
        }
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
          [file, checksum],
        );
        await client.query("COMMIT");
        applied.push(file);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    return { applied };
  } finally {
    if (lockAcquired) {
      await client.query("SELECT pg_advisory_unlock($1)", [migrationLockId]).catch(() => undefined);
    }
    await client.end();
  }
}
