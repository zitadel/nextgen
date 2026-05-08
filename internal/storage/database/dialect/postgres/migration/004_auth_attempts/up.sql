CREATE TABLE zitadel_nextgen.auth_attempts (
    project_id TEXT NOT NULL
    , id TEXT NOT NULL CHECK (id <> '')
    , handoff_token TEXT
    , handed_off_at TIMESTAMPTZ
    , handoff_idempotency_key TEXT
    , session_id TEXT

    , required_checks SMALLINT[]
    , created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , completed_at TIMESTAMPTZ
    , time_to_live INTERVAL

    , PRIMARY KEY (project_id, id)
    , UNIQUE (project_id, handoff_token)
--     , FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.instances(id) -- TODO: rename instances to projects and update the foreign key reference accordingly
);

CREATE TABLE zitadel_nextgen.auth_attempt_checks (
    project_id TEXT NOT NULL
    , auth_attempt_id TEXT NOT NULL

    , challenge_id TEXT
    , type SMALLINT NOT NULL CHECK(type > 0)

    -- initiated time, it is set when the challenge is created and stored; it is not updated when the challenge is verified successfully or unsuccessfully
    , last_challenged_at TIMESTAMPTZ
    -- verification time, it is set when the challenge or factor is verified successfully
    , last_verified_at TIMESTAMPTZ
    -- failure time, it is set when the challenge or factor is verified unsuccessfully
    , last_failed_at TIMESTAMPTZ
    -- failure count, it is incremented when the challenge or factor is verified unsuccessfully; successful verification does not reset it automatically
    , failure_count SMALLINT NOT NULL DEFAULT 0 CHECK (failure_count >= 0)

    -- payload field for the challenge, it can be used to store the necessary information for the challenge (e.g. the totp secret, hash of otp code, etc.)
    , challenge_payload JSONB -- the payload of the challenge (e.g. the password hash, the totp secret, etc.)
    , factor_payload JSONB -- the payload of the factor (e.g. the user id, etc.)

    , PRIMARY KEY (project_id, auth_attempt_id, type)
--     , FOREIGN KEY (project_id, auth_attempt_id) REFERENCES zitadel_nextgen.auth_attempts(project_id, id) ON DELETE CASCADE
);
