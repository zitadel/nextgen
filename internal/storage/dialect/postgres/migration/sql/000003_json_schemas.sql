-- +goose Up
CREATE TABLE zitadel_nextgen.json_schemas (
    project_id    TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , url         TEXT COLLATE "C" NOT NULL
    , object_type TEXT COLLATE "C"
    , kind        TEXT COLLATE "C" NOT NULL
    , created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , payload    JSON        NOT NULL

    , PRIMARY KEY (project_id, url)
);

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.json_schemas;
