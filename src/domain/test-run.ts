export const TEST_RUN_STATUSES = ["queued", "running", "passed", "failed", "skipped"] as const;

export type TestRunStatus = (typeof TEST_RUN_STATUSES)[number];

export type CoverageInput = {
  coveredScenarios: number;
  totalScenarios: number;
};

export type FpgaMetricsInput = {
  lutUsed: number;
  lutTotal: number;
  ffUsed: number;
  ffTotal: number;
  bramUsed: number;
  bramTotal: number;
  dspUsed: number;
  dspTotal: number;
  timingSlackNs: number;
};

export type TestRunInput = {
  regressionRunId: number;
  testId: number;
  status: TestRunStatus;
  durationMs: number | null;
  errorMessage: string | null;
  coverage: CoverageInput | null;
  metrics: FpgaMetricsInput | null;
};
