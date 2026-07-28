-- +goose Up
CREATE TABLE zitadel_nextgen.teams(
    project_id TEXT COLLATE "C" NOT NULL
    REFERENCES zitadel_nextgen.projects (id)
    ON DELETE CASCADE
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , name TEXT NOT NULL
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

    /* TODO: add more columns here */

    , PRIMARY KEY (project_id, id)
);

-- +goose Down
DROP TABLE zitadel_nextgen.teams;
