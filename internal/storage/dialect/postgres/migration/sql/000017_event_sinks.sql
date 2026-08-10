-- +goose Up
CREATE TABLE zitadel_nextgen.event_sinks (
    id          TEXT    NOT NULL CHECK (id <> '')
    , type      TEXT    NOT NULL
    , scope     TEXT    NOT NULL
    , project_id TEXT
    , url       TEXT
    , enabled   BOOLEAN NOT NULL DEFAULT TRUE
    , PRIMARY KEY (id)
);

CREATE TABLE zitadel_nextgen.event_deliveries (
    project_id      TEXT        NOT NULL
    , event_id      TEXT        NOT NULL
    , sink_id       TEXT        NOT NULL
    , delivered_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    , PRIMARY KEY (project_id, event_id, sink_id)
    , FOREIGN KEY (project_id, event_id)
        REFERENCES zitadel_nextgen.events (project_id, id)
        ON DELETE CASCADE
);

CREATE INDEX idx_event_deliveries_sink
    ON zitadel_nextgen.event_deliveries (sink_id, project_id, event_id);

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.event_deliveries;
DROP TABLE IF EXISTS zitadel_nextgen.event_sinks;
