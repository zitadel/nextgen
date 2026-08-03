-- +goose Up
CREATE TABLE zitadel_nextgen.auth_attempts (
    project_id      TEXT        NOT NULL
    , id            BIGINT      GENERATED ALWAYS AS IDENTITY
    , handoff_token BYTEA
    , handed_off_at TIMESTAMPTZ
    , session_id    BIGINT
    , required_checks SMALLINT[]
    , created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , time_to_live  INTERVAL

    , PRIMARY KEY (project_id, id)
    , UNIQUE (project_id, handoff_token)
    , FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects(id) ON DELETE CASCADE
);

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.auth_attempts;
