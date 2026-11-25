-- +goose NO TRANSACTION
-- +goose Up
-- See the postgres migration (ADR 065). Durations are INT64 nanoseconds.
-- Spanner has no partial unique indexes: active_unique_key is NULL when the
-- row is not live (done/dead or no unique_key); NULL_FILTERED unique index
-- enforces at most one live row per key.
-- +goose StatementBegin
CREATE TABLE jobs (
    id               STRING(MAX) NOT NULL,
    name             STRING(MAX) NOT NULL,
    payload          BYTES(MAX)  NOT NULL,
    unique_key       STRING(MAX),
    -- unique_key when status IN ('pending','leased') AND unique_key IS NOT NULL; else NULL.
    active_unique_key STRING(MAX),
    run_at           TIMESTAMP   NOT NULL,
    not_after        TIMESTAMP,
    lease_until      TIMESTAMP,
    lease_by         STRING(MAX),
    lease_token      STRING(MAX),
    attempt          INT64       NOT NULL DEFAULT (0),
    max_attempts     INT64       NOT NULL DEFAULT (0),
    last_error       STRING(MAX),
    status           STRING(MAX) NOT NULL DEFAULT ('pending'),
    completed_at     TIMESTAMP,
    CONSTRAINT chk_jobs_id CHECK (id <> ''),
    CONSTRAINT chk_jobs_name CHECK (name <> ''),
    CONSTRAINT chk_jobs_status CHECK (status = 'pending' OR status = 'leased' OR status = 'done' OR status = 'dead'),
) PRIMARY KEY (id)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE NULL_FILTERED INDEX idx_jobs_active_unique_key
    ON jobs (active_unique_key)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_jobs_take
    ON jobs (status, run_at, id)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE NULL_FILTERED INDEX idx_jobs_completed_at
    ON jobs (completed_at)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE job_schedules (
    id           STRING(MAX) NOT NULL,
    name         STRING(MAX) NOT NULL,
    period       INT64       NOT NULL,
    run_at       TIMESTAMP   NOT NULL,
    lease_until  TIMESTAMP,
    lease_by     STRING(MAX),
    lease_token  STRING(MAX),
    last_error   STRING(MAX),
    attempt      INT64       NOT NULL DEFAULT (0),
    CONSTRAINT chk_job_schedules_id CHECK (id <> ''),
    CONSTRAINT chk_job_schedules_name CHECK (name <> ''),
) PRIMARY KEY (id)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX idx_job_schedules_name
    ON job_schedules (name)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_job_schedules_take
    ON job_schedules (run_at, id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_job_schedules_take
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_job_schedules_name
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS job_schedules
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_jobs_completed_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_jobs_take
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_jobs_active_unique_key
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS jobs
-- +goose StatementEnd
