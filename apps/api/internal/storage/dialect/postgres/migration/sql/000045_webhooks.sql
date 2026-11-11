-- +goose Up
-- A project's webhook (ADR 088): a URL the project's events are sent to. The
-- key and the cascade from projects are those of policies (000035).
CREATE TABLE zitadel_nextgen.webhooks (
    project_id TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    -- Not unique: two webhooks of one project may name the same URL.
    , url TEXT NOT NULL
    , description TEXT NOT NULL
    , event_types TEXT[] NOT NULL
    , enabled BOOLEAN NOT NULL
    -- Ciphertext the service layer produced; storage never reads it.
    , secret TEXT NOT NULL
    , previous_secret TEXT
    , previous_secret_expires_at TIMESTAMPTZ
    , last_delivered_at TIMESTAMPTZ
    , last_error_at TIMESTAMPTZ
    , last_error_status INTEGER
    -- The delivery watermark on an event's (created_at, id): a webhook has
    -- one project, so its cursor is on its row.
    , cursor_created_at TIMESTAMPTZ NOT NULL
    , cursor_event_id TEXT COLLATE "C" NOT NULL
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, id)
);

-- Webhooks list newest first by keyset; id breaks created_at ties, and a
-- btree also scans backward.
CREATE INDEX idx_webhooks_project_created_at
    ON zitadel_nextgen.webhooks (project_id, created_at, id);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_webhooks_project_created_at;
DROP TABLE IF EXISTS zitadel_nextgen.webhooks;
