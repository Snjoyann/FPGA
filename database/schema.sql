CREATE TABLE IF NOT EXISTS regression_runs (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  version VARCHAR(80) NOT NULL,
  branch VARCHAR(100) NOT NULL DEFAULT 'main',
  commit_sha VARCHAR(40),
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tests (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  suite VARCHAR(100) NOT NULL DEFAULT 'default',
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS test_runs (
  id SERIAL PRIMARY KEY,
  regression_run_id INTEGER NOT NULL REFERENCES regression_runs(id) ON DELETE CASCADE,
  test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE RESTRICT,
  status VARCHAR(10) NOT NULL CHECK (status IN ('queued', 'running', 'passed', 'failed', 'skipped')),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (regression_run_id, test_id)
);

CREATE TABLE IF NOT EXISTS coverage_results (
  id SERIAL PRIMARY KEY,
  test_run_id INTEGER NOT NULL UNIQUE REFERENCES test_runs(id) ON DELETE CASCADE,
  covered_scenarios INTEGER NOT NULL CHECK (covered_scenarios >= 0),
  total_scenarios INTEGER NOT NULL CHECK (total_scenarios > 0),
  CHECK (covered_scenarios <= total_scenarios)
);

CREATE TABLE IF NOT EXISTS fpga_metrics (
  id SERIAL PRIMARY KEY,
  test_run_id INTEGER NOT NULL UNIQUE REFERENCES test_runs(id) ON DELETE CASCADE,
  lut_used INTEGER NOT NULL CHECK (lut_used >= 0),
  lut_total INTEGER NOT NULL CHECK (lut_total > 0 AND lut_used <= lut_total),
  ff_used INTEGER NOT NULL CHECK (ff_used >= 0),
  ff_total INTEGER NOT NULL CHECK (ff_total > 0 AND ff_used <= ff_total),
  bram_used INTEGER NOT NULL CHECK (bram_used >= 0),
  bram_total INTEGER NOT NULL CHECK (bram_total > 0 AND bram_used <= bram_total),
  dsp_used INTEGER NOT NULL CHECK (dsp_used >= 0),
  dsp_total INTEGER NOT NULL CHECK (dsp_total > 0 AND dsp_used <= dsp_total),
  timing_slack_ns NUMERIC(10, 3) NOT NULL
);

CREATE INDEX IF NOT EXISTS test_runs_regression_run_id_idx ON test_runs(regression_run_id);
CREATE INDEX IF NOT EXISTS test_runs_test_id_idx ON test_runs(test_id);
CREATE INDEX IF NOT EXISTS test_runs_status_idx ON test_runs(status);

-- Safe, repeatable upgrades from the early learning schema.
ALTER TABLE regression_runs ADD COLUMN IF NOT EXISTS version VARCHAR(80);
ALTER TABLE regression_runs ADD COLUMN IF NOT EXISTS branch VARCHAR(100) NOT NULL DEFAULT 'main';
ALTER TABLE regression_runs ADD COLUMN IF NOT EXISTS commit_sha VARCHAR(40);
ALTER TABLE regression_runs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE regression_runs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE regression_runs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE regression_runs SET version = name WHERE version IS NULL;
ALTER TABLE regression_runs ALTER COLUMN version SET NOT NULL;

ALTER TABLE tests ADD COLUMN IF NOT EXISTS suite VARCHAR(100) NOT NULL DEFAULT 'default';
ALTER TABLE tests ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
DECLARE old_constraint TEXT;
BEGIN
  SELECT conname INTO old_constraint
  FROM pg_constraint
  WHERE conrelid = 'test_runs'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%'
    AND pg_get_constraintdef(oid) NOT LIKE '%queued%'
  LIMIT 1;

  IF old_constraint IS NOT NULL THEN
    EXECUTE 'ALTER TABLE test_runs DROP CONSTRAINT ' || quote_ident(old_constraint);
    ALTER TABLE test_runs ADD CONSTRAINT test_runs_status_check
      CHECK (status IN ('queued', 'running', 'passed', 'failed', 'skipped'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS test_runs_regression_test_idx
  ON test_runs(regression_run_id, test_id);

