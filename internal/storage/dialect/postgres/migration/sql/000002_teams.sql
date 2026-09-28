-- +goose Up
CREATE TABLE zitadel_nextgen.teams(
    project_id TEXT COLLATE "C" NOT NULL
    REFERENCES zitadel_nextgen.projects (id)
    ON DELETE CASCADE
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , name TEXT NOT NULL CHECK (name <> '' AND length(name) <= 200)
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

    /* TODO: add more columns here */

    , PRIMARY KEY (project_id, id)
);

-- Team names are unique per project, case-insensitive.
CREATE UNIQUE INDEX uq_teams_project_name
    ON zitadel_nextgen.teams (project_id, lower(name));

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.uq_teams_project_name;
DROP TABLE zitadel_nextgen.teams;
