-- +goose Up
CREATE TABLE zitadel_nextgen.auth_attempts (
    project_id      TEXT        NOT NULL
    , id            TEXT        NOT NULL CHECK (id <> '')
    , handoff_token TEXT
    , handed_off_at TIMESTAMPTZ
    , session_id    TEXT
    , required_checks SMALLINT[]
    , created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , completed_at  TIMESTAMPTZ
    , time_to_live  INTERVAL

    , PRIMARY KEY (project_id, id)
    , UNIQUE (project_id, handoff_token)
    , FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects(id)
);

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.auth_attempts;
