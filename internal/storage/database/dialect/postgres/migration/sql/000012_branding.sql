-- +goose Up
CREATE TABLE zitadel_nextgen.branding (
    project_id   TEXT NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , id         TEXT NOT NULL CHECK (id <> '')
    , definition JSONB NOT NULL
    , created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

    , PRIMARY KEY (project_id, id)
);

-- Serves the latest-revision-per-project resolution on flow responses;
-- id (ULID) is the deterministic tiebreak for same-timestamp revisions.
CREATE INDEX idx_branding_project_created_at
    ON zitadel_nextgen.branding (project_id, created_at DESC, id DESC);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_branding_project_created_at;
DROP TABLE IF EXISTS zitadel_nextgen.branding;
