-- +goose Up
CREATE TABLE zitadel_nextgen.checks (
    project_id TEXT NOT NULL
    , id TEXT NOT NULL CHECK (id <> '')
    , auth_attempt_id TEXT
    , session_id TEXT
    , type SMALLINT NOT NULL CHECK (type > 0)
    , user_password_id BIGINT
    , user_totp_id BIGINT
    , user_passkey_id BIGINT
    , user_recovery_codes_id BIGINT
    , started_at TIMESTAMPTZ
    , succeeded_at TIMESTAMPTZ
    , failed_at TIMESTAMPTZ
    , handedoff_at TIMESTAMPTZ
    , failure_count SMALLINT NOT NULL DEFAULT 0 CHECK (failure_count >= 0)
    , challenge JSONB
    , factor JSONB
    , supersedes TEXT

    , PRIMARY KEY (project_id, id)
    , FOREIGN KEY (project_id, auth_attempt_id) REFERENCES zitadel_nextgen.auth_attempts(project_id, id) ON DELETE CASCADE
    , FOREIGN KEY (project_id, session_id) REFERENCES zitadel_nextgen.sessions(project_id, id) ON DELETE CASCADE
    , FOREIGN KEY (project_id, supersedes) REFERENCES zitadel_nextgen.checks(project_id, id)
    , FOREIGN KEY (user_password_id) REFERENCES zitadel_nextgen.user_passwords(id)
    , FOREIGN KEY (user_totp_id) REFERENCES zitadel_nextgen.user_totp(id)
    , FOREIGN KEY (user_passkey_id) REFERENCES zitadel_nextgen.user_passkeys(id)
    , FOREIGN KEY (user_recovery_codes_id) REFERENCES zitadel_nextgen.user_recovery_codes(id)
    , CHECK (
        num_nonnulls(user_password_id, user_totp_id, user_passkey_id, user_recovery_codes_id) <= 1
    )
);

CREATE UNIQUE INDEX checks_auth_attempt_type
    ON zitadel_nextgen.checks (project_id, auth_attempt_id, type);

CREATE INDEX checks_session
    ON zitadel_nextgen.checks (project_id, session_id)
    WHERE session_id IS NOT NULL;

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.checks;
