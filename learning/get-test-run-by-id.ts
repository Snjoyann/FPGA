import express from "express";

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

const wantedId = 3;
const foundTestRun = testRuns.find((testRun) => testRun.id === wantedId);

const result: { rows: TestRun[] } = {
  rows: [{ id: 3, name: "light_test", status: "passed" }],
};

const testRunFromRows = result.rows[0] ?? null;

const sql = `SELECT * FROM test_runs WHERE id = $1`;
const values = [wantedId];

async function getTestRunById(id: number) {
  // Իրական db.ts-ում այստեղ կլինի՝
  // const result = await pool.query(sql, [id]);
  // return result.rows[0] ?? null;

  const testRun = testRuns.find((item) => item.id === id);
  return testRun ?? null;
}

const app = express();

app.get("/learning/test-runs/:id", async (request, response) => {
  const id = Number(request.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return response.status(400).json({
      message: "id must be a positive integer",
    });
  }

  const testRun = await getTestRunById(id);

  if (!testRun) {
    return response.status(404).json({
      message: "Test run not found",
    });
  }

  return response.status(200).json(testRun);
});

app.listen(3001, () => {
  console.log("Learning server: http://127.0.0.1:3001/learning/test-runs/3");
});

