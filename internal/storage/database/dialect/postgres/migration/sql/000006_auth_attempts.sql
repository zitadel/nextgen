-- +goose Up
CREATE TABLE zitadel_nextgen.auth_attempts (
    project_id      TEXT        NOT NULL
    , id            BIGINT      GENERATED ALWAYS AS IDENTITY
    , handoff_token TEXT
    , handed_off_at TIMESTAMPTZ
    , session_id    BIGINT
    , required_checks SMALLINT[]
    , created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , completed_at  TIMESTAMPTZ
    , time_to_live  INTERVAL

    , PRIMARY KEY (project_id, id)
    , UNIQUE (project_id, handoff_token)
    , FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects(id)
);

CREATE TABLE zitadel_nextgen.auth_attempt_checks (
    project_id          TEXT        NOT NULL
    , auth_attempt_id   BIGINT      NOT NULL
    , type              SMALLINT    NOT NULL CHECK(type > 0)

    , last_challenged_at    TIMESTAMPTZ
    , last_verified_at      TIMESTAMPTZ
    , last_failed_at        TIMESTAMPTZ
    , failure_count         SMALLINT    NOT NULL DEFAULT 0 CHECK (failure_count >= 0)

    , challenge_payload JSONB
    , factor_payload    JSONB

    , PRIMARY KEY (project_id, auth_attempt_id, type)
    , FOREIGN KEY (project_id, auth_attempt_id) REFERENCES zitadel_nextgen.auth_attempts(project_id, id) ON DELETE CASCADE
);

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.auth_attempt_checks;
DROP TABLE IF EXISTS zitadel_nextgen.auth_attempts;
