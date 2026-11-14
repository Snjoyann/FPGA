import pg from "pg";

import { pool } from "../database/pool.js";
import type { TestRunInput, TestRunStatus } from "../domain/test-run.js";

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

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const result = await pool.query(
    `${testRunSelect} ${clause} ORDER BY tr.created_at DESC, tr.id DESC`,
    values,
  );
  return result.rows;
}

export async function getTestRunById(id: number, client: pg.PoolClient | pg.Pool = pool) {
  const result = await client.query(`${testRunSelect} WHERE tr.id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function referencedRowsExist(regressionRunId: number, testId: number) {
  const result = await pool.query(`
    SELECT
      EXISTS(SELECT 1 FROM regression_runs WHERE id = $1) AS "regressionRunExists",
      EXISTS(SELECT 1 FROM tests WHERE id = $2) AS "testExists"
  `, [regressionRunId, testId]);
  return result.rows[0] as { regressionRunExists: boolean; testExists: boolean };
}

async function saveDetails(client: pg.PoolClient, testRunId: number, input: TestRunInput) {
  if (input.coverage) {
    await client.query(`
      INSERT INTO coverage_results (test_run_id, covered_scenarios, total_scenarios)
      VALUES ($1, $2, $3)
      ON CONFLICT (test_run_id) DO UPDATE SET
        covered_scenarios = EXCLUDED.covered_scenarios,
        total_scenarios = EXCLUDED.total_scenarios
    `, [testRunId, input.coverage.coveredScenarios, input.coverage.totalScenarios]);
  } else {
    await client.query("DELETE FROM coverage_results WHERE test_run_id = $1", [testRunId]);
  }

  if (input.metrics) {
    const metrics = input.metrics;
    await client.query(`
      INSERT INTO fpga_metrics (
        test_run_id, lut_used, lut_total, ff_used, ff_total,
        bram_used, bram_total, dsp_used, dsp_total, timing_slack_ns
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (test_run_id) DO UPDATE SET
        lut_used=EXCLUDED.lut_used, lut_total=EXCLUDED.lut_total,
        ff_used=EXCLUDED.ff_used, ff_total=EXCLUDED.ff_total,
        bram_used=EXCLUDED.bram_used, bram_total=EXCLUDED.bram_total,
        dsp_used=EXCLUDED.dsp_used, dsp_total=EXCLUDED.dsp_total,
        timing_slack_ns=EXCLUDED.timing_slack_ns
    `, [
      testRunId,
      metrics.lutUsed, metrics.lutTotal,
      metrics.ffUsed, metrics.ffTotal,
      metrics.bramUsed, metrics.bramTotal,
      metrics.dspUsed, metrics.dspTotal,
      metrics.timingSlackNs,
    ]);
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

    const inserted = await client.query(`
      INSERT INTO test_runs (regression_run_id, test_id, status, duration_ms, error_message)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING id
    `, [input.regressionRunId, input.testId, input.status, input.durationMs, input.errorMessage]);
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

    await client.query(`
      UPDATE test_runs
      SET regression_run_id=$1, test_id=$2, status=$3, duration_ms=$4,
          error_message=$5, updated_at=NOW()
      WHERE id=$6
    `, [input.regressionRunId, input.testId, input.status, input.durationMs, input.errorMessage, id]);
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
