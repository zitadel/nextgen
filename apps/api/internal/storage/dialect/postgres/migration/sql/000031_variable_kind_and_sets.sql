-- +goose Up
-- A variable now says which kind of target it applies to, primary or preview,
-- and a deployment keeps the values it was created with as a frozen set
-- (ADR 069).
--
-- The variables table is dropped and recreated rather than altered. There is
-- no data to keep: the product is in alpha, and recreating is what SQLite and
-- Spanner have to do for a new primary key anyway, so every dialect drops the
-- rows and behaves the same. The drop takes idx_variables_project_name with
-- it, which the new key makes redundant (see the key below).
DROP TABLE zitadel_nextgen.variables;

-- One row per variable: a value entered by one project under one name, for
-- one kind of target. A value that applies to both kinds is two rows, one per
-- kind, and nothing falls back from one kind to the other: a preview read
-- never sees a primary value.
CREATE TABLE zitadel_nextgen.variables (
    project_id TEXT NOT NULL CHECK (project_id <> '')
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , name TEXT NOT NULL CHECK (name <> '')
    -- The target the value applies to. Held as the name rather than a number
    -- so a reordering of the Go constants cannot reinterpret rows already
    -- written; the CHECK is the enum.
    , kind TEXT COLLATE "C" NOT NULL CHECK (kind IN ('primary', 'preview'))
    , value JSONB NOT NULL
    , is_secret BOOLEAN NOT NULL DEFAULT FALSE
    , created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

    -- The natural key. Making it the primary key is what stops two variables
    -- from existing at the same owner and kind under one name, which would
    -- make a read return both with no rule for choosing between them. It is
    -- also the upsert conflict target and the only way to address a row.
    --
    -- It leads with project_id, so it also serves a read of one project and
    -- the cascade when a project is deleted, which is what the old key needed
    -- idx_variables_project_name for.
    , PRIMARY KEY (project_id, name, kind)
);

-- The values a deployment was created with, frozen as one immutable JSON
-- document per distinct set of values in a project. content_hash is the
-- SHA-256 of the entries, computed in Go, named as releases.content_hash is:
-- Spanner's JSON type does not round-trip bytes,
-- so the column can never be the preimage. The key is what makes identical
-- values one row: a deploy whose values did not change inserts nothing, and
-- a rollback reuses the set it rolls back to.
--
-- Sets are per project and never shared across projects: an equal hash in two
-- projects would reveal that two tenants hold the same values.
CREATE TABLE zitadel_nextgen.variable_sets (
    project_id TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , content_hash TEXT COLLATE "C" NOT NULL CHECK (length(content_hash) = 64)
    -- {"NAME":{"value":<json>,"secret":bool}}: one kind's values, resolved
    -- before the freeze, so an entry carries no kind. A secret is held as the
    -- ciphertext the variables table held -- a freeze never decrypts -- and
    -- the hash covers that ciphertext, never the plaintext.
    , entries JSONB NOT NULL CHECK (jsonb_typeof(entries) = 'object')
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, content_hash)
);

-- Which set a deployment runs with: one row per deployment, written in the
-- deployment's transaction. Which rows were frozen is the deployment's
-- origin_kind, read when the set is frozen, so the link does not repeat it.
CREATE TABLE zitadel_nextgen.deployment_variable_sets (
    project_id TEXT COLLATE "C" NOT NULL
    , deployment_id TEXT COLLATE "C" NOT NULL
    , set_hash TEXT COLLATE "C" NOT NULL

    , PRIMARY KEY (project_id, deployment_id)
    -- A direct project key beside the deployment key, because Postgres runs
    -- cascades one level at a time. Deleting a project removes variable_sets
    -- at the first level, but through the deployment key alone these rows
    -- would only go at the second (projects, then deployments, 000030), and
    -- the NO ACTION check on the set key below would find them still here
    -- and abort the delete. The direct key removes them at the first level,
    -- beside the sets. sessions has the same shape (000007).
    , CONSTRAINT fk_deployment_variable_sets_project
        FOREIGN KEY (project_id)
        REFERENCES zitadel_nextgen.projects (id)
        ON DELETE CASCADE
    , CONSTRAINT fk_deployment_variable_sets_deployment
        FOREIGN KEY (project_id, deployment_id)
        REFERENCES zitadel_nextgen.deployments (project_id, id)
        ON DELETE CASCADE
    -- NO ACTION, so a set a deployment uses can never be deleted: the
    -- deployment must keep exactly the values it was created with, however
    -- the variables change later. A set no deployment uses any more can be
    -- collected, once something collects.
    , CONSTRAINT fk_deployment_variable_sets_set
        FOREIGN KEY (project_id, set_hash)
        REFERENCES zitadel_nextgen.variable_sets (project_id, content_hash)
        ON DELETE NO ACTION
);

-- The reverse lookup: which deployments use a set. It is what the NO ACTION
-- check above walks when a set is deleted, and what a collector of unused
-- sets will walk.
CREATE INDEX idx_deployment_variable_sets_set
    ON zitadel_nextgen.deployment_variable_sets (project_id, set_hash);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_deployment_variable_sets_set;
DROP TABLE IF EXISTS zitadel_nextgen.deployment_variable_sets;
DROP TABLE IF EXISTS zitadel_nextgen.variable_sets;

-- Back to the 000028 shape, which has no kind. The rows are dropped again:
-- two kinds cannot collapse into a key that has none.
DROP TABLE zitadel_nextgen.variables;

CREATE TABLE zitadel_nextgen.variables (
    name TEXT NOT NULL CHECK (name <> '')
    , project_id TEXT NOT NULL CHECK (project_id <> '')
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , value JSONB NOT NULL
    , is_secret BOOLEAN NOT NULL DEFAULT FALSE
    , created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

    , PRIMARY KEY (name, project_id)
);

CREATE INDEX idx_variables_project_name
    ON zitadel_nextgen.variables (project_id, name);
