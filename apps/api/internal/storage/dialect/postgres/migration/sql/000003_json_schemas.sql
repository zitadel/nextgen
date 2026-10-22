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

-- Revisions of one object type are ordered by created_at, so at most one may
-- carry a given timestamp: a collision has no determinate winner and must fail
-- loudly instead. The index is also the seek the latest-revision anti-join in
-- ListJSONSchemas uses. NULLs are distinct in Postgres, which is what we want —
-- a row with no object_type is not a revision of anything.
CREATE UNIQUE INDEX idx_json_schemas_object_type_revision
    ON zitadel_nextgen.json_schemas (project_id, object_type, created_at);

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.json_schemas;
