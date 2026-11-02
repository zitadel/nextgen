-- +goose Up
-- Usage rollups the projector counts from events (ADR 085). Only the cursor
-- goes with its project: a deleted project's usage stays until it ages out.
CREATE TABLE zitadel_nextgen.usage_first_seen (
    project_id  TEXT COLLATE "C" NOT NULL
    , meter     TEXT COLLATE "C" NOT NULL
    , month     TIMESTAMPTZ      NOT NULL
    , user_id   TEXT COLLATE "C" NOT NULL
    , PRIMARY KEY (project_id, meter, month, user_id)
);

CREATE TABLE zitadel_nextgen.usage_hours (
    project_id  TEXT COLLATE "C" NOT NULL
    , meter     TEXT COLLATE "C" NOT NULL
    , hour      TIMESTAMPTZ      NOT NULL
    , value     BIGINT           NOT NULL
    , PRIMARY KEY (project_id, meter, hour)
);

CREATE TABLE zitadel_nextgen.usage_cursors (
    project_id        TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , counted_before  TIMESTAMPTZ      NOT NULL
    , last_event_id   TEXT COLLATE "C" NOT NULL
    , PRIMARY KEY (project_id)
);

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.usage_cursors;
DROP TABLE IF EXISTS zitadel_nextgen.usage_hours;
DROP TABLE IF EXISTS zitadel_nextgen.usage_first_seen;
