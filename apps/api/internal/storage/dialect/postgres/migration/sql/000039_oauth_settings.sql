-- +goose Up
-- One immutable revision of a project's OAuth settings. A release is the only
-- writer and pins a revision under kind oauth; the deployed release decides
-- which revision an origin runs, so no column records which one is newest.
CREATE TABLE zitadel_nextgen.oauth_settings (
    project_id   TEXT NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , id         TEXT NOT NULL CHECK (id <> '')
    , definition JSONB NOT NULL
    , created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

    , PRIMARY KEY (project_id, id)
);

-- Serves the newest-first list a release build scans for a matching
-- revision; id is the deterministic tiebreak for same-timestamp revisions.
CREATE INDEX idx_oauth_settings_project_created_at
    ON zitadel_nextgen.oauth_settings (project_id, created_at DESC, id DESC);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_oauth_settings_project_created_at;
DROP TABLE IF EXISTS zitadel_nextgen.oauth_settings;
