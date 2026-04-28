CREATE TABLE zitadel_nextgen.auth_attempts (
    project_id TEXT NOT NULL
    , id TEXT NOT NULL CHECK (id <> '')

    , required_checks SMALLINT[]
    , created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , completed_at TIMESTAMPTZ
    , time_to_live INTERVAL

    , PRIMARY KEY (project_id, id)
    -- TODO:, FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects(id)
);

CREATE TABLE zitadel_nextgen.auth_attempt_checks (
    project_id TEXT NOT NULL
    , auth_attempt_id TEXT NOT NULL

    -- , id TEXT NOT NULL --TODO: if there can be multiple checks of the same type, we need an id to distinguish them, otherwise we can use the type as the primary key
    , type SMALLINT NOT NULL CHECK(type > 0)

    -- initiated time, it is set when the check gets created
    -- it is only set if the check is a challenge, null otherwise
    , initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- verification time, it is set when the challenge or factor is verified successfully
    , verified_at TIMESTAMPTZ
    -- failure time, it is set when the challenge or factor is verified unsuccessfully
    , last_failed_at TIMESTAMPTZ
    -- failure count, it is incremented when the challenge or factor is verified unsuccessfully, it is reset to 0 when the challenge or factor is verified successfully
    , failure_count SMALLINT NOT NULL DEFAULT 0 CHECK (failure_count >= 0)

    -- payload field for the challenge, it can be used to store the necessary information for the challenge (e.g. the totp secret, hash of otp code, etc.)
    , challenge_payload JSONB -- the payload of the challenge (e.g. the password hash, the totp secret, etc.)
    , factor_payload JSONB -- the payload of the factor (e.g. the user id, etc.)

    , PRIMARY KEY (project_id, auth_attempt_id, type)
    , FOREIGN KEY (project_id, auth_attempt_id) REFERENCES zitadel_nextgen.auth_attempts(project_id, id) ON DELETE CASCADE
);
