import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  TEST_RUN_STATUSES,
  compareRegressionRuns,
  createTestRun,
  deleteTestRunById,
  getCatalog,
  getDashboard,
  getTestRunById,
  getTestRuns,
  referencedRowsExist,
  updateTestRun,
} from "./db.js";
import { parsePositiveId, validateTestRunInput } from "./validation.js";

export const app = express();

app.use(express.json({ limit: "256kb" }));
app.use((_request, response, next) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  next();
});
app.options("*splat", (_request, response) => response.sendStatus(204));

app.get("/api/health", (_request, response) => {
  response.status(200).json({ status: "ok", service: "fpga-test-system" });
});

app.get("/api/catalog", async (_request, response) => {
  response.status(200).json(await getCatalog());
});

app.get("/api/test-runs", async (request, response) => {
  const regressionRunId = request.query.regressionRunId
    ? (parsePositiveId(String(request.query.regressionRunId)) ?? undefined)
    : undefined;
  const status = request.query.status ? String(request.query.status) : undefined;
  if (request.query.regressionRunId && !regressionRunId) {
    return response.status(400).json({ message: "regressionRunId must be a positive integer" });
  }
  if (status && !TEST_RUN_STATUSES.includes(status as (typeof TEST_RUN_STATUSES)[number])) {
    return response.status(400).json({ message: `status must be one of: ${TEST_RUN_STATUSES.join(", ")}` });
  }
  const testRuns = await getTestRuns({
    regressionRunId,
    status: status as (typeof TEST_RUN_STATUSES)[number] | undefined,
  });
  return response.status(200).json(testRuns);
});

app.get("/api/test-runs/:id", async (request, response) => {
  const id = parsePositiveId(request.params.id);
  if (!id) return response.status(400).json({ message: "id must be a positive integer" });
  const testRun = await getTestRunById(id);
  if (!testRun) return response.status(404).json({ message: "Test run not found" });
  return response.status(200).json(testRun);
});

app.post("/api/test-runs", async (request, response) => {
  const parsed = validateTestRunInput(request.body);
  if (!parsed.ok) return response.status(400).json({ message: "Validation failed", errors: parsed.errors });
  const references = await referencedRowsExist(parsed.value.regressionRunId, parsed.value.testId);
  if (!references.regressionRunExists || !references.testExists) {
    return response.status(404).json({ message: "Regression run or test does not exist" });
  }
  return response.status(201).json(await createTestRun(parsed.value));
});

app.put("/api/test-runs/:id", async (request, response) => {
  const id = parsePositiveId(request.params.id);
  if (!id) return response.status(400).json({ message: "id must be a positive integer" });
  const parsed = validateTestRunInput(request.body);
  if (!parsed.ok) return response.status(400).json({ message: "Validation failed", errors: parsed.errors });
  const references = await referencedRowsExist(parsed.value.regressionRunId, parsed.value.testId);
  if (!references.regressionRunExists || !references.testExists) {
    return response.status(404).json({ message: "Regression run or test does not exist" });
  }
  const updated = await updateTestRun(id, parsed.value);
  if (!updated) return response.status(404).json({ message: "Test run not found" });
  return response.status(200).json(updated);
});

app.patch("/api/test-runs/:id", async (request, response) => {
  const id = parsePositiveId(request.params.id);
  if (!id) return response.status(400).json({ message: "id must be a positive integer" });
  const existing = await getTestRunById(id);
  if (!existing) return response.status(404).json({ message: "Test run not found" });
  const merged = {
    regressionRunId: existing.regressionRunId,
    testId: existing.testId,
    status: existing.status,
    durationMs: existing.durationMs,
    errorMessage: existing.errorMessage,
    coverage: existing.coverage,
    metrics: existing.metrics,
    ...request.body,
  };
  const parsed = validateTestRunInput(merged);
  if (!parsed.ok) return response.status(400).json({ message: "Validation failed", errors: parsed.errors });
  return response.status(200).json(await updateTestRun(id, parsed.value));
});

app.delete("/api/test-runs/:id", async (request, response) => {
  const id = parsePositiveId(request.params.id);
  if (!id) return response.status(400).json({ message: "id must be a positive integer" });
  const deleted = await deleteTestRunById(id);
  if (!deleted) return response.status(404).json({ message: "Test run not found" });
  return response.status(200).json(deleted);
});

app.get("/api/dashboard", async (request, response) => {
  const regressionRunId = request.query.regressionRunId
    ? (parsePositiveId(String(request.query.regressionRunId)) ?? undefined)
    : undefined;
  if (request.query.regressionRunId && !regressionRunId) {
    return response.status(400).json({ message: "regressionRunId must be a positive integer" });
  }
  return response.status(200).json(await getDashboard(regressionRunId));
});

app.get("/api/compare", async (request, response) => {
  const leftId = parsePositiveId(String(request.query.left ?? ""));
  const rightId = parsePositiveId(String(request.query.right ?? ""));
  if (!leftId || !rightId || leftId === rightId) {
    return response.status(400).json({ message: "left and right must be different positive regression run IDs" });
  }
  const comparison = await compareRegressionRuns(leftId, rightId);
  if (!comparison) return response.status(404).json({ message: "One or both regression runs were not found" });
  return response.status(200).json(comparison);
});

const frontendDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/dist");
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get("/{*splat}", (request, response, next) => {
    if (request.path.startsWith("/api/")) return next();
    return response.sendFile(path.join(frontendDist, "index.html"));
  });
}

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  console.error(error);
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (code === "23505") return response.status(409).json({ message: "This test already exists in the selected regression run" });
  if (code === "23503" || code === "23514" || code === "22P02") {
    return response.status(400).json({ message: "The submitted data violates a database constraint" });
  }
  return response.status(500).json({ message: "Internal server error" });
});
