-- +goose Up
-- One row per variable: a value entered by one owner under one name.
--
-- environment_name is NOT NULL with an empty-string default rather than
-- nullable. Empty means "not scoped to an environment", which keeps the natural
-- key usable as a primary key (a nullable column cannot be), makes uniqueness
-- per owner enforceable without NULLS NOT DISTINCT, and matches the domain,
-- where the unset environment is also "".
--
-- Both owner columns are matched exactly on read, so the empty string is an
-- address of its own -- the project level -- and not a wildcard. project_id has
-- to be set all the same: it carries the foreign key, and a variable with no
-- project would belong to nothing.
CREATE TABLE zitadel_nextgen.variables (
    name             TEXT NOT NULL CHECK (name <> '')
    , project_id     TEXT NOT NULL CHECK (project_id <> '')
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    -- Scoped by environment name, not id, the way an environment is addressed
    -- everywhere else. It cannot carry a foreign key: the empty string means
    -- "not scoped to an environment", and no environment row answers to it.
    -- TODO: check the environment exists on the write path instead.
    , environment_name TEXT NOT NULL DEFAULT ''
    , value          JSONB NOT NULL
    , is_secret      BOOLEAN NOT NULL DEFAULT FALSE
    , created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , modified_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()

    -- The natural key. Making it the primary key is what stops two variables
    -- from existing at the same owner under one name, which would make a read
    -- return both with no rule for choosing between them. It is also the
    -- upsert conflict target and the only way to address a row.
    , PRIMARY KEY (name, project_id, environment_name)
);

-- The primary key leads with name, so nothing above serves a read of one
-- project: listing a project's variables, and the cascade when a project is
-- deleted, both need project_id in front.
CREATE INDEX idx_variables_project_name
    ON zitadel_nextgen.variables (project_id, name);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_variables_project_name;
DROP TABLE IF EXISTS zitadel_nextgen.variables;
