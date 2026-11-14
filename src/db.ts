import "dotenv/config";

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is missing. Copy backend/.env.example to backend/.env and configure PostgreSQL.");
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
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(schemaSql);

    await client.query(`
      INSERT INTO regression_runs (name, version, branch, commit_sha, started_at, completed_at)
      VALUES
        ('Nightly #104', 'v1.4.0', 'main', 'a91de13', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days' + INTERVAL '14 minutes'),
        ('Nightly #105', 'v1.5.0-rc1', 'release/1.5', 'c72ab80', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day' + INTERVAL '13 minutes')
      ON CONFLICT (name) DO UPDATE SET
        version = EXCLUDED.version,
        branch = EXCLUDED.branch,
        commit_sha = EXCLUDED.commit_sha
    `);

    await client.query(`
      INSERT INTO tests (name, suite, description)
      VALUES
        ('uart_rx_smoke', 'UART', 'Receives a nominal UART frame'),
        ('uart_parity_error', 'UART', 'Detects a bad parity bit'),
        ('dma_burst_transfer', 'DMA', 'Transfers a 256-word DMA burst'),
        ('clock_domain_crossing', 'Timing', 'Exercises the asynchronous CDC path'),
        ('bram_ecc_recovery', 'Memory', 'Corrects a single-bit BRAM error')
      ON CONFLICT (name) DO UPDATE SET
        suite = EXCLUDED.suite,
        description = EXCLUDED.description
    `);

    await client.query(`
      INSERT INTO test_runs (regression_run_id, test_id, status, duration_ms, error_message)
      SELECT rr.id, t.id, seed.status, seed.duration_ms, seed.error_message
      FROM (VALUES
        ('Nightly #104', 'uart_rx_smoke', 'passed', 842, NULL),
        ('Nightly #104', 'uart_parity_error', 'failed', 1190, 'Expected parity_error=1 after 8 cycles'),
        ('Nightly #104', 'dma_burst_transfer', 'passed', 3470, NULL),
        ('Nightly #104', 'clock_domain_crossing', 'failed', 5280, 'Setup violation on cdc_sync/path_2'),
        ('Nightly #104', 'bram_ecc_recovery', 'passed', 2110, NULL),
        ('Nightly #105', 'uart_rx_smoke', 'passed', 801, NULL),
        ('Nightly #105', 'uart_parity_error', 'passed', 1138, NULL),
        ('Nightly #105', 'dma_burst_transfer', 'passed', 3312, NULL),
        ('Nightly #105', 'clock_domain_crossing', 'passed', 5010, NULL),
        ('Nightly #105', 'bram_ecc_recovery', 'failed', 2250, 'ECC correction counter remained zero')
      ) AS seed(regression_name, test_name, status, duration_ms, error_message)
      JOIN regression_runs rr ON rr.name = seed.regression_name
      JOIN tests t ON t.name = seed.test_name
      WHERE NOT EXISTS (
        SELECT 1 FROM test_runs existing
        WHERE existing.regression_run_id = rr.id AND existing.test_id = t.id
      )
      ON CONFLICT DO NOTHING
    `);

    await client.query(`
      INSERT INTO coverage_results (test_run_id, covered_scenarios, total_scenarios)
      SELECT tr.id, seed.covered, seed.total
      FROM (VALUES
        ('Nightly #104', 'uart_rx_smoke', 74, 80),
        ('Nightly #104', 'uart_parity_error', 51, 64),
        ('Nightly #104', 'dma_burst_transfer', 88, 96),
        ('Nightly #104', 'clock_domain_crossing', 39, 60),
        ('Nightly #104', 'bram_ecc_recovery', 55, 64),
        ('Nightly #105', 'uart_rx_smoke', 78, 80),
        ('Nightly #105', 'uart_parity_error', 62, 64),
        ('Nightly #105', 'dma_burst_transfer', 94, 96),
        ('Nightly #105', 'clock_domain_crossing', 56, 60),
        ('Nightly #105', 'bram_ecc_recovery', 59, 64)
      ) AS seed(regression_name, test_name, covered, total)
      JOIN regression_runs rr ON rr.name = seed.regression_name
      JOIN tests t ON t.name = seed.test_name
      JOIN test_runs tr ON tr.regression_run_id = rr.id AND tr.test_id = t.id
      ON CONFLICT (test_run_id) DO NOTHING
    `);

    await client.query(`
      INSERT INTO fpga_metrics
        (test_run_id, lut_used, lut_total, ff_used, ff_total, bram_used, bram_total, dsp_used, dsp_total, timing_slack_ns)
      SELECT tr.id, seed.lut_used, 50000, seed.ff_used, 100000, seed.bram_used, 140, seed.dsp_used, 220, seed.slack
      FROM (VALUES
        ('Nightly #104', 'uart_rx_smoke', 18120, 29750, 41, 34, 0.42),
        ('Nightly #104', 'uart_parity_error', 18240, 29910, 41, 34, 0.38),
        ('Nightly #104', 'dma_burst_transfer', 22680, 35440, 58, 70, 0.21),
        ('Nightly #104', 'clock_domain_crossing', 23910, 37120, 58, 70, -0.18),
        ('Nightly #104', 'bram_ecc_recovery', 23120, 36200, 72, 70, 0.16),
        ('Nightly #105', 'uart_rx_smoke', 17640, 29120, 40, 32, 0.67),
        ('Nightly #105', 'uart_parity_error', 17790, 29320, 40, 32, 0.61),
        ('Nightly #105', 'dma_burst_transfer', 21980, 34700, 56, 68, 0.49),
        ('Nightly #105', 'clock_domain_crossing', 22810, 35840, 56, 68, 0.31),
        ('Nightly #105', 'bram_ecc_recovery', 22460, 35110, 70, 68, 0.28)
      ) AS seed(regression_name, test_name, lut_used, ff_used, bram_used, dsp_used, slack)
      JOIN regression_runs rr ON rr.name = seed.regression_name
      JOIN tests t ON t.name = seed.test_name
      JOIN test_runs tr ON tr.regression_run_id = rr.id AND tr.test_id = t.id
      ON CONFLICT (test_run_id) DO NOTHING
    `);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
