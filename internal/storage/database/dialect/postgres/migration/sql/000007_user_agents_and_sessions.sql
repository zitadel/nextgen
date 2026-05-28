-- +goose Up
CREATE TABLE zitadel_nextgen.user_agents (
    project_id      TEXT        NOT NULL
    , id            BIGINT      GENERATED ALWAYS AS IDENTITY
    , info          JSONB       NOT NULL DEFAULT '{}'::JSONB
    , created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()

    , PRIMARY KEY (project_id, id)
    , FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects(id)
);

CREATE TABLE zitadel_nextgen.sessions (
    project_id      TEXT        NOT NULL
    , id            BIGINT      GENERATED ALWAYS AS IDENTITY
    , created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , time_to_live  INTERVAL NOT NULL DEFAULT '10 minutes'::INTERVAL
    , expires_at    TIMESTAMPTZ NOT NULL
    , token_id      BIGINT      NOT NULL -- TODO: reference to the token table
    , user_id       TEXT
    , user_agent_id BIGINT

    , PRIMARY KEY (project_id, id)
    , UNIQUE (project_id, token_id)
    , FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects(id)
    , FOREIGN KEY (project_id, user_id) REFERENCES zitadel_nextgen.users(project_id, id)
    , FOREIGN KEY (project_id, user_agent_id) REFERENCES zitadel_nextgen.user_agents(project_id, id)
);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION zitadel_nextgen.set_session_expires_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.expires_at := NEW.updated_at + NEW.time_to_live;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sessions_set_expires_at
    BEFORE INSERT OR UPDATE OF updated_at, time_to_live ON zitadel_nextgen.sessions
    FOR EACH ROW
    EXECUTE FUNCTION zitadel_nextgen.set_session_expires_at();
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TRIGGER IF EXISTS trg_sessions_set_expires_at ON zitadel_nextgen.sessions;
DROP FUNCTION IF EXISTS zitadel_nextgen.set_session_expires_at();
-- +goose StatementEnd
DROP TABLE IF EXISTS zitadel_nextgen.sessions;
DROP TABLE IF EXISTS zitadel_nextgen.user_agents;