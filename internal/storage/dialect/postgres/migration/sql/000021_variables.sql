-- +goose Up
-- One row per variable: a value entered by one owner under one name.
--
-- environment_id is NOT NULL with an empty-string default rather than
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
    -- Scoped by environment id, not name. The wire addresses an environment by
    -- name (GET /variables?environment_name=prod) and the name is resolved to
    -- this id at the edge, because a name is not identity: an environment that
    -- is renamed is the same environment, and a table keyed on its name would
    -- have to be rewritten with the rename or block it outright (#965).
    , environment_id  TEXT NOT NULL DEFAULT ''
    -- The environment reference, carried by a generated column so that the
    -- empty string above can stay a real address while the reference is still
    -- enforced by the database.
    --
    -- A foreign key cannot sit on environment_id itself: '' is the project
    -- level and no environment row answers to it, so every project-level
    -- variable would violate the constraint. NULLIF maps exactly that address
    -- to NULL, and a composite foreign key is not checked when any of its
    -- columns is NULL (MATCH SIMPLE). So a project-level row skips the
    -- constraint, an environment-scoped row is held to it, and an id nothing
    -- answers to is refused on write instead of scoping a variable into
    -- invisibility -- which, with no inheritance to fall back on, read as
    -- empty rather than as the project's value.
    --
    -- STORED because a foreign key needs a materialized column. It is derived,
    -- never written, and deliberately not bound in variable.Schema: the row
    -- shape and every statement address environment_id.
    , environment_ref TEXT GENERATED ALWAYS AS (NULLIF(environment_id, '')) STORED
    , value          JSONB NOT NULL
    , is_secret      BOOLEAN NOT NULL DEFAULT FALSE
    , created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , modified_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()

    -- The natural key. Making it the primary key is what stops two variables
    -- from existing at the same owner under one name, which would make a read
    -- return both with no rule for choosing between them. It is also the
    -- upsert conflict target and the only way to address a row.
    , PRIMARY KEY (name, project_id, environment_id)

    -- Deleting an environment takes its variables with it, the way deleting a
    -- project does. There is no ON UPDATE clause and none is needed: the id is
    -- the environment's primary key and nothing rewrites it, so a rename moves
    -- the name column and leaves every row here pointing at the same
    -- environment. Spanner has no ON UPDATE CASCADE either way.
    , CONSTRAINT fk_variables_environment
        FOREIGN KEY (project_id, environment_ref)
        REFERENCES zitadel_nextgen.environments (project_id, id)
        ON DELETE CASCADE
);

-- The primary key leads with name, so nothing above serves a read of one
-- project: listing a project's variables, and the cascade when a project is
-- deleted, both need project_id in front.
CREATE INDEX idx_variables_project_name
    ON zitadel_nextgen.variables (project_id, name);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_variables_project_name;
DROP TABLE IF EXISTS zitadel_nextgen.variables;
