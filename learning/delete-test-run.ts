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

const indexToDelete = testRuns.findIndex(
  (testRun) => testRun.id === wantedId,
);

if (indexToDelete !== -1) {
  const [deletedTestRun] = testRuns.splice(indexToDelete, 1);
}

const sql = `
  DELETE FROM test_runs
  WHERE id = $1
  RETURNING *
`;

const values = [wantedId];

async function deleteTestRunById(id: number) {
  // Իրական db.ts-ում այստեղ կլինի՝
  // const result = await pool.query(sql, [id]);
  // return result.rows[0] ?? null;
}

