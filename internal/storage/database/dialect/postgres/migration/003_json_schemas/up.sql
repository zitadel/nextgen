CREATE TABLE zitadel_nextgen.json_schemas(
    instance_id TEXT NOT NULL
        REFERENCES zitadel_nextgen.instances (id)
        ON DELETE CASCADE
    , url TEXT NOT NULL
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , payload JSON NOT NULL
    
    , PRIMARY KEY (instance_id, url)
);
