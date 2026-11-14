import { TEST_RUN_STATUSES, type TestRunInput } from "./db.js";

type ValidationResult =
  | { ok: true; value: TestRunInput }
  | { ok: false; errors: string[] };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonNegativeInteger = (value: unknown) =>
  Number.isInteger(value) && (value as number) >= 0;

const isPositiveInteger = (value: unknown) =>
  Number.isInteger(value) && (value as number) > 0;

export function validateTestRunInput(body: unknown): ValidationResult {
  if (!isObject(body)) return { ok: false, errors: ["Request body must be a JSON object"] };

  const errors: string[] = [];
  if (!isPositiveInteger(body.regressionRunId)) errors.push("regressionRunId must be a positive integer");
  if (!isPositiveInteger(body.testId)) errors.push("testId must be a positive integer");
  if (!TEST_RUN_STATUSES.includes(body.status as (typeof TEST_RUN_STATUSES)[number])) {
    errors.push(`status must be one of: ${TEST_RUN_STATUSES.join(", ")}`);
  }
  if (body.durationMs !== null && body.durationMs !== undefined && !isNonNegativeInteger(body.durationMs)) {
    errors.push("durationMs must be a non-negative integer or null");
  }
  if (body.errorMessage !== null && body.errorMessage !== undefined && typeof body.errorMessage !== "string") {
    errors.push("errorMessage must be a string or null");
  }

  let coverage: TestRunInput["coverage"] = null;
  if (body.coverage !== null && body.coverage !== undefined) {
    if (!isObject(body.coverage)) {
      errors.push("coverage must be an object or null");
    } else if (!isNonNegativeInteger(body.coverage.coveredScenarios) || !isPositiveInteger(body.coverage.totalScenarios)) {
      errors.push("coverage values must be integers and totalScenarios must be greater than zero");
    } else if ((body.coverage.coveredScenarios as number) > (body.coverage.totalScenarios as number)) {
      errors.push("coverage.coveredScenarios cannot exceed totalScenarios");
    } else {
      coverage = {
        coveredScenarios: body.coverage.coveredScenarios as number,
        totalScenarios: body.coverage.totalScenarios as number,
      };
    }
  }

  let metrics: TestRunInput["metrics"] = null;
  if (body.metrics !== null && body.metrics !== undefined) {
    if (!isObject(body.metrics)) {
      errors.push("metrics must be an object or null");
    } else {
      const pairs = [
        ["lutUsed", "lutTotal"], ["ffUsed", "ffTotal"],
        ["bramUsed", "bramTotal"], ["dspUsed", "dspTotal"],
      ] as const;
      for (const [used, total] of pairs) {
        if (!isNonNegativeInteger(body.metrics[used]) || !isPositiveInteger(body.metrics[total])) {
          errors.push(`metrics.${used} must be non-negative and ${total} must be positive integers`);
        } else if ((body.metrics[used] as number) > (body.metrics[total] as number)) {
          errors.push(`metrics.${used} cannot exceed ${total}`);
        }
      }
      if (typeof body.metrics.timingSlackNs !== "number" || !Number.isFinite(body.metrics.timingSlackNs)) {
        errors.push("metrics.timingSlackNs must be a finite number");
      }
      if (!errors.some((error) => error.startsWith("metrics."))) {
        metrics = {
          lutUsed: body.metrics.lutUsed as number,
          lutTotal: body.metrics.lutTotal as number,
          ffUsed: body.metrics.ffUsed as number,
          ffTotal: body.metrics.ffTotal as number,
          bramUsed: body.metrics.bramUsed as number,
          bramTotal: body.metrics.bramTotal as number,
          dspUsed: body.metrics.dspUsed as number,
          dspTotal: body.metrics.dspTotal as number,
          timingSlackNs: body.metrics.timingSlackNs as number,
        };
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      regressionRunId: body.regressionRunId as number,
      testId: body.testId as number,
      status: body.status as TestRunInput["status"],
      durationMs: (body.durationMs as number | null | undefined) ?? null,
      errorMessage: (body.errorMessage as string | null | undefined) ?? null,
      coverage,
      metrics,
    },
  };
}

export function parsePositiveId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
