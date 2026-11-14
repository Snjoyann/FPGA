import { pool } from "../database/pool.js";

export async function getCatalog() {
  const [regressionRuns, tests] = await Promise.all([
    pool.query(`
      SELECT
        id, name, version, branch,
        commit_sha AS "commitSha",
        started_at AS "startedAt",
        completed_at AS "completedAt"
      FROM regression_runs
      ORDER BY CASE WHEN version LIKE 'v%' THEN 0 ELSE 1 END, started_at DESC
    `),
    pool.query("SELECT id, name, suite, description FROM tests ORDER BY suite, name"),
  ]);

  return { regressionRuns: regressionRuns.rows, tests: tests.rows };
}
