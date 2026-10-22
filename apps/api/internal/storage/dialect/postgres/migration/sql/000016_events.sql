-- +goose Up
-- project_id is an opaque tenancy scope (ADR 048), not a live FK: hard-deleting
-- a project must leave audit history (incl. project.deleted) for retention to purge.
CREATE TABLE zitadel_nextgen.events (
    project_id          TEXT        NOT NULL
    , id                TEXT        NOT NULL CHECK (id <> '')
    , event_type        TEXT        NOT NULL
    , category          TEXT        NOT NULL
    , occurred_at       TIMESTAMPTZ NOT NULL
    , created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    , team_id           TEXT
    , actor_id          TEXT
    , actor_type        TEXT
    , entity_type       TEXT
    , entity_id         TEXT
    , client_id         TEXT        NOT NULL DEFAULT ''
    , token_id          TEXT        NOT NULL DEFAULT ''
    , delegation_type   TEXT        NOT NULL DEFAULT ''
    , delegation_id     TEXT        NOT NULL DEFAULT ''
    , grantor           TEXT        NOT NULL DEFAULT ''
    , fingerprint       TEXT        NOT NULL DEFAULT ''
    , request_id        TEXT
    , session_id        TEXT
    , flow_id           TEXT
    , payload           JSONB       NOT NULL DEFAULT '{}'::jsonb
    , metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb
    , PRIMARY KEY (project_id, id)
);

CREATE INDEX idx_events_project_created_at_id
    ON zitadel_nextgen.events (project_id, created_at, id);

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.events;
