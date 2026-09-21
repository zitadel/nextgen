-- +goose Up
-- One row per policy revision (ADR 066): the developer-authored instance for
-- one catalogued operation. Revisions are immutable; the newest per
-- operation and audience is the one evaluation resolves.
CREATE TABLE zitadel_nextgen.policies (
    project_id   TEXT NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , id         TEXT NOT NULL CHECK (id <> '')
    , operation  TEXT NOT NULL CHECK (operation <> '')
    , definition JSONB NOT NULL
    , created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

    , PRIMARY KEY (project_id, id)
);

-- Serves newest-revision-per-operation resolution; id (ULID) is the
-- deterministic tiebreak for same-timestamp revisions.
CREATE INDEX idx_policies_project_operation_created_at
    ON zitadel_nextgen.policies (project_id, operation, created_at DESC, id DESC);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_policies_project_operation_created_at;
DROP TABLE IF EXISTS zitadel_nextgen.policies;
