CREATE TABLE zitadel_nextgen.json_schemas(
    project_id TEXT NOT NULL
        REFERENCES zitadel_nextgen.projects (id)
        ON DELETE CASCADE
    , url TEXT NOT NULL
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , payload JSON NOT NULL

    , PRIMARY KEY (project_id, url)
);
