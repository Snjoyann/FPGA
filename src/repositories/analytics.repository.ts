import { pool } from "../database/pool.js";

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
  const meta = await pool.query(`
    SELECT id, name, version, branch
    FROM regression_runs
    WHERE id = ANY($1::int[])
    ORDER BY id
  `, [[leftId, rightId]]);
  if (meta.rows.length !== 2) return null;

  const summaries = await Promise.all([getDashboard(leftId), getDashboard(rightId)]);
  const changes = await pool.query(`
    WITH latest_test_runs AS (
      SELECT DISTINCT ON (regression_run_id, test_id) *
      FROM test_runs
      ORDER BY regression_run_id, test_id, updated_at DESC, id DESC
    )
    SELECT
      t.name,
      left_run.status AS "leftStatus",
      right_run.status AS "rightStatus",
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
