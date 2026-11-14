import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";
import pg from "pg";

const rootEnvPath = fileURLToPath(new URL("../../.env", import.meta.url));
config({ path: rootEnvPath });

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is missing. Copy .env.example to the project root as .env and configure PostgreSQL.");
}

const pool = new Pool({ connectionString });

export const TEST_RUN_STATUSES = ["queued", "running", "passed", "failed", "skipped"] as const;
export type TestRunStatus = (typeof TEST_RUN_STATUSES)[number];

export type CoverageInput = {
  coveredScenarios: number;
  totalScenarios: number;
};

export type FpgaMetricsInput = {
  lutUsed: number;
  lutTotal: number;
  ffUsed: number;
  ffTotal: number;
  bramUsed: number;
  bramTotal: number;
  dspUsed: number;
  dspTotal: number;
  timingSlackNs: number;
};

export type TestRunInput = {
  regressionRunId: number;
  testId: number;
  status: TestRunStatus;
  durationMs: number | null;
  errorMessage: string | null;
  coverage: CoverageInput | null;
  metrics: FpgaMetricsInput | null;
};

const testRunSelect = `
  SELECT
    tr.id,
    tr.regression_run_id AS "regressionRunId",
    rr.name AS "regressionName",
    rr.version,
    tr.test_id AS "testId",
    t.name,
    t.suite,
    tr.status,
    tr.duration_ms AS "durationMs",
    tr.error_message AS "errorMessage",
    tr.created_at AS "createdAt",
    tr.updated_at AS "updatedAt",
    CASE WHEN cr.id IS NULL THEN NULL ELSE json_build_object(
      'coveredScenarios', cr.covered_scenarios,
      'totalScenarios', cr.total_scenarios,
      'percent', ROUND(cr.covered_scenarios * 100.0 / cr.total_scenarios, 2)
    ) END AS coverage,
    CASE WHEN fm.id IS NULL THEN NULL ELSE json_build_object(
      'lutUsed', fm.lut_used, 'lutTotal', fm.lut_total,
      'ffUsed', fm.ff_used, 'ffTotal', fm.ff_total,
      'bramUsed', fm.bram_used, 'bramTotal', fm.bram_total,
      'dspUsed', fm.dsp_used, 'dspTotal', fm.dsp_total,
      'timingSlackNs', fm.timing_slack_ns
    ) END AS metrics
  FROM (
    SELECT DISTINCT ON (regression_run_id, test_id) *
    FROM test_runs
    ORDER BY regression_run_id, test_id, updated_at DESC, id DESC
  ) tr
  JOIN regression_runs rr ON rr.id = tr.regression_run_id
  JOIN tests t ON t.id = tr.test_id
  LEFT JOIN coverage_results cr ON cr.test_run_id = tr.id
  LEFT JOIN fpga_metrics fm ON fm.test_run_id = tr.id
`;

export async function checkDatabaseConnection() {
  await pool.query("SELECT 1");
}

export async function initializeDatabase() {
  const schemaPath = fileURLToPath(new URL("../database/schema.sql", import.meta.url));
  const schemaSql = await readFile(schemaPath, "utf8");
  await pool.query(schemaSql);
}

export async function getCatalog() {
  const [regressionRuns, tests] = await Promise.all([
    pool.query(`SELECT id, name, version, branch, commit_sha AS "commitSha", started_at AS "startedAt", completed_at AS "completedAt" FROM regression_runs ORDER BY CASE WHEN version LIKE 'v%' THEN 0 ELSE 1 END, started_at DESC`),
    pool.query(`SELECT id, name, suite, description FROM tests ORDER BY suite, name`),
  ]);
  return { regressionRuns: regressionRuns.rows, tests: tests.rows };
}

export async function getTestRuns(filters: { regressionRunId?: number; status?: TestRunStatus } = {}) {
  const values: unknown[] = [];
  const where: string[] = [];
  if (filters.regressionRunId) {
    values.push(filters.regressionRunId);
    where.push(`tr.regression_run_id = $${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    where.push(`tr.status = $${values.length}`);
  }
  const result = await pool.query(`${testRunSelect} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY tr.created_at DESC, tr.id DESC`, values);
  return result.rows;
}

export async function getTestRunById(id: number, client: pg.PoolClient | pg.Pool = pool) {
  const result = await client.query(`${testRunSelect} WHERE tr.id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function referencedRowsExist(regressionRunId: number, testId: number) {
  const result = await pool.query(`SELECT EXISTS(SELECT 1 FROM regression_runs WHERE id = $1) AS "regressionRunExists", EXISTS(SELECT 1 FROM tests WHERE id = $2) AS "testExists"`, [regressionRunId, testId]);
  return result.rows[0] as { regressionRunExists: boolean; testExists: boolean };
}

async function saveDetails(client: pg.PoolClient, testRunId: number, input: TestRunInput) {
  if (input.coverage) {
    await client.query(`INSERT INTO coverage_results (test_run_id, covered_scenarios, total_scenarios) VALUES ($1, $2, $3) ON CONFLICT (test_run_id) DO UPDATE SET covered_scenarios = EXCLUDED.covered_scenarios, total_scenarios = EXCLUDED.total_scenarios`, [testRunId, input.coverage.coveredScenarios, input.coverage.totalScenarios]);
  } else {
    await client.query("DELETE FROM coverage_results WHERE test_run_id = $1", [testRunId]);
  }
  if (input.metrics) {
    const m = input.metrics;
    await client.query(`INSERT INTO fpga_metrics (test_run_id, lut_used, lut_total, ff_used, ff_total, bram_used, bram_total, dsp_used, dsp_total, timing_slack_ns) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (test_run_id) DO UPDATE SET lut_used=EXCLUDED.lut_used,lut_total=EXCLUDED.lut_total,ff_used=EXCLUDED.ff_used,ff_total=EXCLUDED.ff_total,bram_used=EXCLUDED.bram_used,bram_total=EXCLUDED.bram_total,dsp_used=EXCLUDED.dsp_used,dsp_total=EXCLUDED.dsp_total,timing_slack_ns=EXCLUDED.timing_slack_ns`, [testRunId, m.lutUsed, m.lutTotal, m.ffUsed, m.ffTotal, m.bramUsed, m.bramTotal, m.dspUsed, m.dspTotal, m.timingSlackNs]);
  } else {
    await client.query("DELETE FROM fpga_metrics WHERE test_run_id = $1", [testRunId]);
  }
}

export async function createTestRun(input: TestRunInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const duplicate = await client.query(
      "SELECT 1 FROM test_runs WHERE regression_run_id = $1 AND test_id = $2 LIMIT 1",
      [input.regressionRunId, input.testId],
    );
    if (duplicate.rowCount) {
      throw Object.assign(new Error("Duplicate test run"), { code: "23505" });
    }
    const inserted = await client.query(`INSERT INTO test_runs (regression_run_id, test_id, status, duration_ms, error_message) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [input.regressionRunId, input.testId, input.status, input.durationMs, input.errorMessage]);
    const id = inserted.rows[0].id as number;
    await saveDetails(client, id, input);
    const record = await getTestRunById(id, client);
    await client.query("COMMIT");
    return record;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateTestRun(id: number, input: TestRunInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{ regression_run_id: number; test_id: number }>(
      "SELECT regression_run_id, test_id FROM test_runs WHERE id = $1",
      [id],
    );
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return null;
    }
    const relationshipChanged =
      current.rows[0].regression_run_id !== input.regressionRunId ||
      current.rows[0].test_id !== input.testId;
    if (relationshipChanged) {
      const duplicate = await client.query(
        "SELECT 1 FROM test_runs WHERE regression_run_id = $1 AND test_id = $2 AND id <> $3 LIMIT 1",
        [input.regressionRunId, input.testId, id],
      );
      if (duplicate.rowCount) {
        throw Object.assign(new Error("Duplicate test run"), { code: "23505" });
      }
    }
    const updated = await client.query(`UPDATE test_runs SET regression_run_id=$1,test_id=$2,status=$3,duration_ms=$4,error_message=$5,updated_at=NOW() WHERE id=$6 RETURNING id`, [input.regressionRunId, input.testId, input.status, input.durationMs, input.errorMessage, id]);
    await saveDetails(client, id, input);
    const record = await getTestRunById(id, client);
    await client.query("COMMIT");
    return record;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteTestRunById(id: number) {
  const existing = await getTestRunById(id);
  if (!existing) return null;
  await pool.query("DELETE FROM test_runs WHERE id = $1", [id]);
  return existing;
}

export async function getDashboard(regressionRunId?: number) {
  const values = regressionRunId ? [regressionRunId] : [];
  const where = regressionRunId ? "WHERE tr.regression_run_id = $1" : "";
  const result = await pool.query(`
    WITH latest_test_runs AS (
      SELECT DISTINCT ON (regression_run_id, test_id) *
      FROM test_runs
      ORDER BY regression_run_id, test_id, updated_at DESC, id DESC
    )
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE tr.status = 'passed')::int AS passed,
      COUNT(*) FILTER (WHERE tr.status = 'failed')::int AS failed,
      COUNT(*) FILTER (WHERE tr.status IN ('queued','running','skipped'))::int AS other,
      COALESCE(ROUND(AVG(cr.covered_scenarios * 100.0 / NULLIF(cr.total_scenarios, 0)), 2), 0) AS "averageCoverage",
      COALESCE(ROUND(AVG(fm.lut_used * 100.0 / fm.lut_total), 2), 0) AS "lutPercent",
      COALESCE(ROUND(AVG(fm.ff_used * 100.0 / fm.ff_total), 2), 0) AS "ffPercent",
      COALESCE(ROUND(AVG(fm.bram_used * 100.0 / fm.bram_total), 2), 0) AS "bramPercent",
      COALESCE(ROUND(AVG(fm.dsp_used * 100.0 / fm.dsp_total), 2), 0) AS "dspPercent",
      MIN(fm.timing_slack_ns) AS "worstTimingSlackNs"
    FROM latest_test_runs tr
    LEFT JOIN coverage_results cr ON cr.test_run_id = tr.id
    LEFT JOIN fpga_metrics fm ON fm.test_run_id = tr.id
    ${where}
  `, values);
  return result.rows[0];
}

export async function compareRegressionRuns(leftId: number, rightId: number) {
  const meta = await pool.query(`SELECT id, name, version, branch FROM regression_runs WHERE id = ANY($1::int[]) ORDER BY id`, [[leftId, rightId]]);
  if (meta.rows.length !== 2) return null;
  const summaries = await Promise.all([getDashboard(leftId), getDashboard(rightId)]);
  const changes = await pool.query(`
    WITH latest_test_runs AS (
      SELECT DISTINCT ON (regression_run_id, test_id) *
      FROM test_runs
      ORDER BY regression_run_id, test_id, updated_at DESC, id DESC
    )
    SELECT t.name,
      left_run.status AS "leftStatus", right_run.status AS "rightStatus",
      ROUND(left_cov.covered_scenarios * 100.0 / left_cov.total_scenarios, 2) AS "leftCoverage",
      ROUND(right_cov.covered_scenarios * 100.0 / right_cov.total_scenarios, 2) AS "rightCoverage"
    FROM tests t
    LEFT JOIN latest_test_runs left_run ON left_run.test_id=t.id AND left_run.regression_run_id=$1
    LEFT JOIN latest_test_runs right_run ON right_run.test_id=t.id AND right_run.regression_run_id=$2
    LEFT JOIN coverage_results left_cov ON left_cov.test_run_id=left_run.id
    LEFT JOIN coverage_results right_cov ON right_cov.test_run_id=right_run.id
    WHERE left_run.id IS NOT NULL OR right_run.id IS NOT NULL
    ORDER BY t.name
  `, [leftId, rightId]);
  const byId = new Map(meta.rows.map((row) => [row.id, row]));
  return {
    left: { regressionRun: byId.get(leftId), summary: summaries[0] },
    right: { regressionRun: byId.get(rightId), summary: summaries[1] },
    tests: changes.rows,
  };
}

export async function closeDatabase() {
  await pool.end();
}
