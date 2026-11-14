import { Router } from "express";

import { TEST_RUN_STATUSES } from "../domain/test-run.js";
import { validateTestRunInput } from "../domain/test-run.validation.js";
import {
  createTestRun,
  deleteTestRunById,
  getTestRunById,
  getTestRuns,
  referencedRowsExist,
  updateTestRun,
} from "../repositories/test-run.repository.js";
import { parsePositiveId } from "../shared/http/params.js";

export const testRunRouter = Router();

testRunRouter.get("/", async (request, response) => {
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

testRunRouter.get("/:id", async (request, response) => {
  const id = parsePositiveId(request.params.id);
  if (!id) return response.status(400).json({ message: "id must be a positive integer" });

  const testRun = await getTestRunById(id);
  if (!testRun) return response.status(404).json({ message: "Test run not found" });
  return response.status(200).json(testRun);
});

testRunRouter.post("/", async (request, response) => {
  const parsed = validateTestRunInput(request.body);
  if (!parsed.ok) {
    return response.status(400).json({ message: "Validation failed", errors: parsed.errors });
  }

  const references = await referencedRowsExist(parsed.value.regressionRunId, parsed.value.testId);
  if (!references.regressionRunExists || !references.testExists) {
    return response.status(404).json({ message: "Regression run or test does not exist" });
  }
  return response.status(201).json(await createTestRun(parsed.value));
});

testRunRouter.put("/:id", async (request, response) => {
  const id = parsePositiveId(request.params.id);
  if (!id) return response.status(400).json({ message: "id must be a positive integer" });

  const parsed = validateTestRunInput(request.body);
  if (!parsed.ok) {
    return response.status(400).json({ message: "Validation failed", errors: parsed.errors });
  }

  const references = await referencedRowsExist(parsed.value.regressionRunId, parsed.value.testId);
  if (!references.regressionRunExists || !references.testExists) {
    return response.status(404).json({ message: "Regression run or test does not exist" });
  }

  const updated = await updateTestRun(id, parsed.value);
  if (!updated) return response.status(404).json({ message: "Test run not found" });
  return response.status(200).json(updated);
});

testRunRouter.patch("/:id", async (request, response) => {
  const id = parsePositiveId(request.params.id);
  if (!id) return response.status(400).json({ message: "id must be a positive integer" });

  const existing = await getTestRunById(id);
  if (!existing) return response.status(404).json({ message: "Test run not found" });

  const parsed = validateTestRunInput({
    regressionRunId: existing.regressionRunId,
    testId: existing.testId,
    status: existing.status,
    durationMs: existing.durationMs,
    errorMessage: existing.errorMessage,
    coverage: existing.coverage,
    metrics: existing.metrics,
    ...request.body,
  });
  if (!parsed.ok) {
    return response.status(400).json({ message: "Validation failed", errors: parsed.errors });
  }
  return response.status(200).json(await updateTestRun(id, parsed.value));
});

testRunRouter.delete("/:id", async (request, response) => {
  const id = parsePositiveId(request.params.id);
  if (!id) return response.status(400).json({ message: "id must be a positive integer" });

  const deleted = await deleteTestRunById(id);
  if (!deleted) return response.status(404).json({ message: "Test run not found" });
  return response.status(200).json(deleted);
});
