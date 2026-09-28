-- +goose Up
CREATE TABLE zitadel_nextgen.event_sinks (
    id          TEXT    NOT NULL CHECK (id <> '')
    , type      TEXT    NOT NULL
    , scope     TEXT    NOT NULL
    , project_id TEXT
    , url       TEXT    NOT NULL DEFAULT ''
    , enabled   BOOLEAN NOT NULL DEFAULT TRUE
    , PRIMARY KEY (id)
    , UNIQUE (type, scope, url)
);

CREATE TABLE zitadel_nextgen.event_sink_cursors (
    sink_id          TEXT        NOT NULL
        REFERENCES zitadel_nextgen.event_sinks (id)
    , project_id     TEXT        NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , last_created_at TIMESTAMPTZ NOT NULL
    , last_event_id  TEXT        NOT NULL
    , PRIMARY KEY (sink_id, project_id)
);

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.event_sink_cursors;
DROP TABLE IF EXISTS zitadel_nextgen.event_sinks;
