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
    , expires_at    TIMESTAMPTZ
    , token_id      BIGINT      NOT NULL -- TODO: reference to the token table
    , user_id       TEXT
    , user_agent_id BIGINT

    , PRIMARY KEY (project_id, id)
    , UNIQUE (project_id, token_id)
    , FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects(id)
    , FOREIGN KEY (project_id, user_id) REFERENCES zitadel_nextgen.users(project_id, id)
    , FOREIGN KEY (project_id, user_agent_id) REFERENCES zitadel_nextgen.user_agents(project_id, id)
);

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.sessions;
DROP TABLE IF EXISTS zitadel_nextgen.user_agents;