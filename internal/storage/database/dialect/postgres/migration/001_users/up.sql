CREATE TABLE zitadel_nextgen.users(
    instance_id TEXT NOT NULL
    , id TEXT NOT NULL CHECK (id <> '')
    , schema_url TEXT NOT NULL CHECK (schema <> '')
    , data_blob JSONB

    , PRIMARY KEY (instance_id, id)
);
