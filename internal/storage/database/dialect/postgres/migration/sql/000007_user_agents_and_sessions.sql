-- +goose Up
CREATE TABLE zitadel_nextgen.user_agents (
    project_id TEXT        NOT NULL
    , id       TEXT        NOT NULL CHECK (id <> '')
    , info     JSONB       NOT NULL DEFAULT '{}'::JSONB
    , created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

    , PRIMARY KEY (project_id, id)
    , FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects(id)
);

CREATE TABLE zitadel_nextgen.sessions (
    project_id    TEXT        NOT NULL
    , id          TEXT        NOT NULL CHECK (id <> '')
    , created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , expires_at  TIMESTAMPTZ
    , token       TEXT        NOT NULL CHECK (token <> '')
    , user_id     TEXT
    , user_agent_id TEXT

    , PRIMARY KEY (project_id, id)
    , UNIQUE (project_id, token)
    , FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects(id)
    , FOREIGN KEY (project_id, user_id) REFERENCES zitadel_nextgen.users(project_id, id)
    , FOREIGN KEY (project_id, user_agent_id) REFERENCES zitadel_nextgen.user_agents(project_id, id)
);

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.sessions;
DROP TABLE IF EXISTS zitadel_nextgen.user_agents;
