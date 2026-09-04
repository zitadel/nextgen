-- +goose Up
-- One row per variable: a value entered by one owner under one name.
--
-- Owner ids are NOT NULL with an empty-string default rather than nullable.
-- Empty means "not scoped at this level", which keeps the natural key usable as
-- a primary key (a nullable column cannot be), makes uniqueness per owner
-- enforceable without NULLS NOT DISTINCT, and matches the domain, where the
-- unset owner id is also "". The cost is that project_id cannot carry a foreign
-- key to projects, since a root-level variable stores '' rather than a project
-- id.
CREATE TABLE zitadel_nextgen.variables (
    name             TEXT NOT NULL CHECK (name <> '')
    , project_id     TEXT NOT NULL DEFAULT ''
    , environment_name TEXT NOT NULL DEFAULT ''
    , team_id        TEXT NOT NULL DEFAULT ''
    , user_schema_id TEXT NOT NULL DEFAULT ''
    , user_id        TEXT NOT NULL DEFAULT ''
    , value          JSONB NOT NULL
    , is_secret      BOOLEAN NOT NULL DEFAULT FALSE
    , created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , modified_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()

    -- The natural key. Making it the primary key is what stops two variables
    -- from existing at the same owner under one name, which would make a read
    -- return both with no rule for choosing between them. It is also the
    -- upsert conflict target and the only way to address a row.
    , PRIMARY KEY (name, project_id, environment_name, team_id, user_schema_id, user_id)

    -- The owner levels below the project are independent of one another: a
    -- variable may name a user in a team without naming an environment or a
    -- user schema, so no level requires the one above it. The project is the
    -- exception, because an empty owner id reads as a wildcard on read -- an
    -- owner such as (team_id set, project_id '') would be visible from every
    -- project. Every variable is entered under a project, so requiring one
    -- here costs nothing and closes that hole.
    , CONSTRAINT variables_owner_needs_project CHECK (
        project_id <> ''
        OR (environment_name = '' AND team_id = '' AND user_schema_id = '' AND user_id = '')
    )
);

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.variables;
