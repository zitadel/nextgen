-- +goose Up
CREATE TABLE zitadel_nextgen.user_agents (
    project_id      TEXT COLLATE "C" NOT NULL
    , id            TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , info          JSONB       NOT NULL
    , created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()

    , PRIMARY KEY (project_id, id)
    , FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects(id) ON DELETE CASCADE
);

CREATE TABLE zitadel_nextgen.sessions (
    project_id      TEXT COLLATE "C" NOT NULL
    , id            TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , time_to_live  INTERVAL NOT NULL
    , expires_at    TIMESTAMPTZ NOT NULL
    , token_id      TEXT COLLATE "C"
    , user_id       TEXT COLLATE "C"
    , user_agent_id TEXT COLLATE "C"

    , PRIMARY KEY (project_id, id)
    , FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects(id) ON DELETE CASCADE
    , CONSTRAINT fk_sessions_user
        FOREIGN KEY (project_id, user_id)
        REFERENCES zitadel_nextgen.users(project_id, id)
        ON DELETE CASCADE
    , FOREIGN KEY (project_id, user_agent_id) REFERENCES zitadel_nextgen.user_agents(project_id, id)
);

CREATE UNIQUE INDEX idx_sessions_token
    ON zitadel_nextgen.sessions (project_id, token_id)
    WHERE token_id IS NOT NULL;

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
DROP INDEX IF EXISTS zitadel_nextgen.idx_sessions_token;
DROP TABLE IF EXISTS zitadel_nextgen.sessions;
DROP TABLE IF EXISTS zitadel_nextgen.user_agents;
