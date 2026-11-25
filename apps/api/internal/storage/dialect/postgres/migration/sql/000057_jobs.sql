-- +goose Up
-- Queued work and terminal rows (ADR 065).
CREATE TABLE zitadel_nextgen.jobs (
    id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , name TEXT COLLATE "C" NOT NULL CHECK (name <> '')
    , payload BYTEA NOT NULL DEFAULT ''
    , unique_key TEXT COLLATE "C"
    , run_at TIMESTAMPTZ NOT NULL
    , not_after TIMESTAMPTZ
    , lease_until TIMESTAMPTZ
    , lease_by TEXT COLLATE "C"
    , lease_token TEXT COLLATE "C"
    , attempt INT NOT NULL DEFAULT 0
    , max_attempts INT NOT NULL DEFAULT 0
    , last_error TEXT
    , status TEXT COLLATE "C" NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'leased', 'done', 'dead'))
    , completed_at TIMESTAMPTZ

    , PRIMARY KEY (id)
);

-- At most one live (pending|leased) row per unique_key. Many NULLs are allowed.
CREATE UNIQUE INDEX idx_jobs_live_unique_key
    ON zitadel_nextgen.jobs (unique_key)
    WHERE unique_key IS NOT NULL AND status IN ('pending', 'leased');

CREATE INDEX idx_jobs_take
    ON zitadel_nextgen.jobs (run_at, id)
    WHERE status IN ('pending', 'leased');

CREATE INDEX idx_jobs_completed_at
    ON zitadel_nextgen.jobs (completed_at)
    WHERE status IN ('done', 'dead');

-- Periodic definitions: one row per name; Complete/Fail only advances run_at.
CREATE TABLE zitadel_nextgen.job_schedules (
    id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , name TEXT COLLATE "C" NOT NULL CHECK (name <> '')
    , period INTERVAL NOT NULL
    , run_at TIMESTAMPTZ NOT NULL
    , lease_until TIMESTAMPTZ
    , lease_by TEXT COLLATE "C"
    , lease_token TEXT COLLATE "C"
    , last_error TEXT
    , attempt INT NOT NULL DEFAULT 0

    , PRIMARY KEY (id)
    , UNIQUE (name)
);

CREATE INDEX idx_job_schedules_take
    ON zitadel_nextgen.job_schedules (run_at, id);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_job_schedules_take;
DROP TABLE IF EXISTS zitadel_nextgen.job_schedules;
DROP INDEX IF EXISTS zitadel_nextgen.idx_jobs_completed_at;
DROP INDEX IF EXISTS zitadel_nextgen.idx_jobs_take;
DROP INDEX IF EXISTS zitadel_nextgen.idx_jobs_live_unique_key;
DROP TABLE IF EXISTS zitadel_nextgen.jobs;
