-- +goose Up
CREATE TABLE zitadel_nextgen.checks (
    project_id          TEXT COLLATE "C" NOT NULL
    , id                TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , auth_attempt_id   TEXT COLLATE "C"
    , session_id        TEXT COLLATE "C"
    , type              SMALLINT    NOT NULL CHECK(type > 0)

    , last_challenged_at    TIMESTAMPTZ
    , last_verified_at      TIMESTAMPTZ
    , last_failed_at        TIMESTAMPTZ
    , failure_count         SMALLINT    NOT NULL DEFAULT 0 CHECK (failure_count >= 0)

    , challenge_payload JSONB
    , factor_payload    JSONB

    -- Hash of a secret a caller presents to find this row when it holds no
    -- other identifier (the SSO callback carries only the state). The row id
    -- stays dialect-minted (ADR 047).
    , lookup_hash       TEXT COLLATE "C"

    , PRIMARY KEY (project_id, id)
    , FOREIGN KEY (project_id, auth_attempt_id) REFERENCES zitadel_nextgen.auth_attempts(project_id, id) ON DELETE CASCADE
    , FOREIGN KEY (project_id, session_id) REFERENCES zitadel_nextgen.sessions(project_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX checks_auth_attempt_type
    ON zitadel_nextgen.checks (project_id, auth_attempt_id, type);

CREATE INDEX checks_session
    ON zitadel_nextgen.checks (project_id, session_id)
    WHERE session_id IS NOT NULL;

CREATE UNIQUE INDEX checks_lookup_hash
    ON zitadel_nextgen.checks (project_id, lookup_hash)
    WHERE lookup_hash IS NOT NULL;

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.checks;
