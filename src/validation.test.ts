import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateTestRunInput } from "./domain/test-run.validation.js";
import { parsePositiveId } from "./shared/http/params.js";

const validInput = {
  regressionRunId: 1,
  testId: 2,
  status: "passed",
  durationMs: 120,
  errorMessage: null,
  coverage: { coveredScenarios: 8, totalScenarios: 10 },
  metrics: {
    lutUsed: 10, lutTotal: 100,
    ffUsed: 20, ffTotal: 200,
    bramUsed: 2, bramTotal: 10,
    dspUsed: 3, dspTotal: 20,
    timingSlackNs: 0.25,
  },
};

describe("test run validation", () => {
  it("accepts complete valid data", () => {
    assert.equal(validateTestRunInput(validInput).ok, true);
  });

  it("rejects coverage above 100 percent", () => {
    const result = validateTestRunInput({ ...validInput, coverage: { coveredScenarios: 11, totalScenarios: 10 } });
    assert.equal(result.ok, false);
  });

  it("rejects resources above device capacity", () => {
    const result = validateTestRunInput({ ...validInput, metrics: { ...validInput.metrics, lutUsed: 101, lutTotal: 100 } });
    assert.equal(result.ok, false);
  });

  it("parses only positive integer IDs", () => {
    assert.equal(parsePositiveId("12"), 12);
    assert.equal(parsePositiveId("0"), null);
    assert.equal(parsePositiveId("abc"), null);
  });
});
