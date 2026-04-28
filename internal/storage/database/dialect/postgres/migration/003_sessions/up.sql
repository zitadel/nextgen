CREATE TABLE zitadel_nextgen.sessions (
    project_id TEXT NOT NULL
    , id TEXT NOT NULL CHECK (id <> '')
    , version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
    , state TEXT NOT NULL CHECK (state IN ('building', 'active', 'expired', 'revoked'))
    , user_id TEXT
    , factors JSONB NOT NULL DEFAULT '{}'::JSONB
    , assurance_levels TEXT[] NOT NULL DEFAULT '{}'::TEXT[]
    , metadata JSONB NOT NULL DEFAULT '{}'::JSONB
    , user_agent JSONB
    , created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , expires_at TIMESTAMPTZ

    , PRIMARY KEY (project_id, id)
);

CREATE INDEX idx_sessions_project_user
    ON zitadel_nextgen.sessions (project_id, user_id);

CREATE INDEX idx_sessions_project_state
    ON zitadel_nextgen.sessions (project_id, state);

CREATE INDEX idx_sessions_project_expires_at
    ON zitadel_nextgen.sessions (project_id, expires_at);
