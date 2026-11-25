-- +goose Up
-- See the postgres migration (ADR 065). Durations are INTEGER nanoseconds.
-- +goose StatementBegin
CREATE TABLE jobs (
    id            TEXT    NOT NULL CHECK (id <> ''),
    name          TEXT    NOT NULL CHECK (name <> ''),
    payload       BLOB    NOT NULL DEFAULT (x''),
    unique_key    TEXT,
    run_at        INTEGER NOT NULL,
    not_after     INTEGER,
    lease_until   INTEGER,
    lease_by      TEXT,
    lease_token   TEXT,
    attempt       INTEGER NOT NULL DEFAULT 0,
    max_attempts  INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    status        TEXT    NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'leased', 'done', 'dead')),
    completed_at  INTEGER,
    PRIMARY KEY (id)
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX idx_jobs_live_unique_key
    ON jobs (unique_key)
    WHERE unique_key IS NOT NULL AND status IN ('pending', 'leased');
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_jobs_take
    ON jobs (run_at, id)
    WHERE status IN ('pending', 'leased');
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_jobs_completed_at
    ON jobs (completed_at)
    WHERE status IN ('done', 'dead');
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE job_schedules (
    id           TEXT    NOT NULL CHECK (id <> ''),
    name         TEXT    NOT NULL CHECK (name <> ''),
    period       INTEGER NOT NULL,
    run_at       INTEGER NOT NULL,
    lease_until  INTEGER,
    lease_by     TEXT,
    lease_token  TEXT,
    last_error   TEXT,
    attempt      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE (name)
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_job_schedules_take
    ON job_schedules (run_at, id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_job_schedules_take;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS job_schedules;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_jobs_completed_at;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_jobs_take;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_jobs_live_unique_key;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS jobs;
-- +goose StatementEnd
