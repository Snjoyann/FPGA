import assert from "node:assert/strict";
import request from "supertest";

import { app } from "./app.js";
import { migrateDatabase } from "./database/migrator.js";
import { closeDatabase } from "./database/pool.js";

try {
  await migrateDatabase();

  const health = await request(app).get("/api/health");
  assert.equal(health.status, 200);

  const catalog = await request(app).get("/api/catalog");
  assert.equal(catalog.status, 200);
  assert.ok(catalog.body.regressionRuns.length >= 2);
  assert.ok(catalog.body.tests.length >= 1);

  const list = await request(app).get("/api/test-runs");
  assert.equal(list.status, 200);
  assert.ok(list.body.length >= 1);

  const invalid = await request(app).post("/api/test-runs").send({
    regressionRunId: 1,
    testId: 1,
    status: "passed",
    coverage: { coveredScenarios: 11, totalScenarios: 10 },
  });
  assert.equal(invalid.status, 400);

  const first = list.body[0];
  const patch = await request(app)
    .patch(`/api/test-runs/${first.id}`)
    .send({ status: first.status === "passed" ? "failed" : "passed" });
  assert.equal(patch.status, 200);

  const restore = await request(app)
    .patch(`/api/test-runs/${first.id}`)
    .send({ status: first.status });
  assert.equal(restore.status, 200);

  const dashboard = await request(app).get("/api/dashboard");
  assert.equal(dashboard.status, 200);
  assert.ok(dashboard.body.total >= 10);

  const [left, right] = catalog.body.regressionRuns;
  assert.ok(left && right);
  const compare = await request(app).get(`/api/compare?left=${left.id}&right=${right.id}`);
  assert.equal(compare.status, 200);
  assert.ok(compare.body.tests.length >= 5);

  console.log("API_SMOKE_OK: health, catalog, list, validation, update, dashboard, and comparison passed");
} finally {
  await closeDatabase();
}
