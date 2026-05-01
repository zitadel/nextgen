CREATE TABLE IF NOT EXISTS zitadel_nextgen.sessions (
    project_id   TEXT        NOT NULL
    , id         TEXT        NOT NULL
    
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , expires_at TIMESTAMPTZ                -- short TTL for anonymous sessions; reset on first factor write

    , token      TEXT        NOT NULL CHECK (token <> '') -- opaque token that changes on every update, used for authentication and session management
    
    , user_id    TEXT
    , user_agent JSONB
    , factors    JSONB       NOT NULL DEFAULT '{}' -- verified factor events with timestamps + properties

    , PRIMARY KEY (project_id, id)
    , UNIQUE (project_id, token)
    , FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.instances(id) -- TODO: rename instances to projects and update the foreign key reference accordingly
    , FOREIGN KEY (project_id, user_id) REFERENCES zitadel_nextgen.users(instance_id, id)
);