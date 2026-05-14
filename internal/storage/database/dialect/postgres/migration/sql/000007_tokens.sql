-- +goose Up
CREATE TABLE zitadel_nextgen.tokens (
    project_id  TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id)
        ON DELETE CASCADE
    , token_id    TEXT COLLATE "C" NOT NULL CHECK (token_id <> '')
    , user_id     TEXT COLLATE "C" NOT NULL
    , session_id  TEXT COLLATE "C"
    , scope       TEXT[] NOT NULL DEFAULT '{}'
    , created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    , expires_at  TIMESTAMPTZ NULL

    , PRIMARY KEY (project_id, token_id)
    , FOREIGN KEY (project_id, user_id)
        REFERENCES zitadel_nextgen.users (project_id, id)
        ON DELETE CASCADE
);

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.tokens;
