CREATE TABLE auth_attempts (
    project_id TEXT NOT NULL
    , id TEXT NOT NULL
    
    , user_id TEXT
    
    , PRIMARY KEY (project_id, id)
    , FOREIGN KEY (project_id, user_id) REFERENCES users(project_id, id)
);

CREATE TABLE challenges (
    project_id TEXT NOT NULL
    , auth_attempt_id TEXT NOT NULL
    , id TEXT NOT NULL

    , challenged_at TIMESTAMPTZ NOT NULL
    , last_succeeded_at TIMESTAMPTZ
    , last_failed_at TIMESTAMPTZ
    , failure_count SMALLINT NOT NULL DEFAULT 0 CHECK (failure_count >= 0)

    , payload JSONB -- the payload of the challenge (e.g. the password hash, the totp secret, etc.)
    
    , PRIMARY KEY (project_id, auth_attempt_id, id)
    , FOREIGN KEY (project_id, auth_attempt_id) REFERENCES auth_attempts(project_id, id)
);