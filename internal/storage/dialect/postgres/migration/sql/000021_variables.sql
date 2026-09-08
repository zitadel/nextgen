-- +goose Up
-- One row per variable: a value entered by one owner under one name.
--
-- The owner is the project and nothing else. project_id carries the foreign
-- key, and a variable with no project would belong to nothing, so it is
-- required. ADR 061 §3 also owns variables at one environment of the project;
-- that level is not implemented, and adding it means another owner column here
-- and in the primary key.
CREATE TABLE zitadel_nextgen.variables (
    name             TEXT NOT NULL CHECK (name <> '')
    , project_id     TEXT NOT NULL CHECK (project_id <> '')
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , value          JSONB NOT NULL
    , is_secret      BOOLEAN NOT NULL DEFAULT FALSE
    , created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , modified_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()

    -- The natural key. Making it the primary key is what stops two variables
    -- from existing at the same owner under one name, which would make a read
    -- return both with no rule for choosing between them. It is also the
    -- upsert conflict target and the only way to address a row.
    , PRIMARY KEY (name, project_id)
);

-- The primary key leads with name, so nothing above serves a read of one
-- project: listing a project's variables, and the cascade when a project is
-- deleted, both need project_id in front.
CREATE INDEX idx_variables_project_name
    ON zitadel_nextgen.variables (project_id, name);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_variables_project_name;
DROP TABLE IF EXISTS zitadel_nextgen.variables;
