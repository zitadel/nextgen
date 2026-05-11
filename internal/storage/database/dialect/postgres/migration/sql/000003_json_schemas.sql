-- +goose Up
CREATE TABLE zitadel_nextgen.json_schemas (
    instance_id  TEXT        NOT NULL
        REFERENCES zitadel_nextgen.instances (id) ON DELETE CASCADE
    , url        TEXT        NOT NULL
    , created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , payload    JSON        NOT NULL

    , PRIMARY KEY (instance_id, url)
);

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.json_schemas;
