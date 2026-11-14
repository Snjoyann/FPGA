type TestRun = {
  id: number;
  name: string;
  status: "passed" | "failed";
};

const testRuns: TestRun[] = [
  { id: 1, name: "uart_rx_test", status: "passed" },
  { id: 2, name: "parity_error_test", status: "failed" },
  { id: 3, name: "light_test", status: "passed" },
];

const wantedId = 2;
const newStatus: TestRun["status"] = "passed";

const testRunToUpdate = testRuns.find(
  (testRun) => testRun.id === wantedId,
);

if (testRunToUpdate) {
  testRunToUpdate.status = newStatus;
}

const sql = `
  UPDATE test_runs
  SET status = $1
  WHERE id = $2
  RETURNING *
`;

const values = [newStatus, wantedId];

async function updateTestRunStatus(
  id: number,
  status: TestRun["status"],
) {
  // Իրական db.ts-ում այստեղ կլինի՝
  // const result = await pool.query(sql, [status, id]);
  // return result.rows[0] ?? null;
}

