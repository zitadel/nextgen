-- +goose Up
CREATE TABLE zitadel_nextgen.users (
    project_id TEXT COLLATE "C" NOT NULL
    , team_id TEXT COLLATE "C" NOT NULL
    , schema_url TEXT COLLATE "C" NOT NULL
    , id TEXT COLLATE "C" NOT NULL CHECK ( id <> '' )
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, id)
    , FOREIGN KEY (project_id, team_id)
        REFERENCES zitadel_nextgen.teams(project_id, id)
        ON DELETE CASCADE
    , FOREIGN KEY (project_id, schema_url)
        REFERENCES zitadel_nextgen.json_schemas(project_id, url)
        ON DELETE RESTRICT
) PARTITION BY HASH (project_id, id);

-- Index for user cascade deletes.
CREATE INDEX idx_users_team_id
    ON zitadel_nextgen.users(project_id, team_id);

CREATE TABLE zitadel_nextgen.users_part_0 PARTITION OF zitadel_nextgen.users FOR VALUES WITH (MODULUS 1, REMAINDER 0);

-- User attributes is EAV store containing all the properties of a user.
-- This is the only table containing PII.
-- It is partitioned by user_id, matching the users table, and therefore optimized to hydrate a user.
-- A couple of indexes are defined for general searching and listing of users.
CREATE TABLE zitadel_nextgen.user_attributes (
    project_id TEXT COLLATE "C" NOT NULL
    , team_id TEXT COLLATE "C" NOT NULL
    , user_id TEXT COLLATE "C" NOT NULL
    , key TEXT NOT NULL COLLATE "C" CHECK ( key <> '' )

    --JSONB allows for dynamic typing
    , value JSONB NOT NULL CHECK (
        -- 1. Prevent 'null'::jsonb values.
        jsonb_typeof(value) <> 'null'
        AND value <> '[]'::jsonb
        AND value <> '{}'::jsonb
        AND value <> '""'::jsonb
    )

    , PRIMARY KEY (project_id, user_id, key)
    , FOREIGN KEY (project_id, user_id)
        REFERENCES zitadel_nextgen.users(project_id, id)
        ON DELETE CASCADE
) PARTITION BY HASH (project_id, user_id);

-- General Lookup Index: Only for scalar values
CREATE INDEX idx_user_attributes_scalar
    ON zitadel_nextgen.user_attributes USING btree
    (project_id, key, value, team_id, user_id)
    WHERE (jsonb_typeof(value) IN ('string', 'number', 'boolean'));

CREATE INDEX idx_user_attributes_team_id
    ON zitadel_nextgen.user_attributes USING btree
    (project_id, team_id);

-- Specialized Array Search Index
-- Uses GIN for containment (@>), but B-Tree logic for the prefix columns
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE INDEX idx_user_attributes_array_search
    ON zitadel_nextgen.user_attributes
    USING GIN (project_id, key, value)
    WHERE (jsonb_typeof(value) = 'array');

CREATE TABLE zitadel_nextgen.user_attributes_part_0 PARTITION OF zitadel_nextgen.user_attributes FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE zitadel_nextgen.user_attributes_part_1 PARTITION OF zitadel_nextgen.user_attributes FOR VALUES WITH (MODULUS 4, REMAINDER 1);
CREATE TABLE zitadel_nextgen.user_attributes_part_2 PARTITION OF zitadel_nextgen.user_attributes FOR VALUES WITH (MODULUS 4, REMAINDER 2);
CREATE TABLE zitadel_nextgen.user_attributes_part_3 PARTITION OF zitadel_nextgen.user_attributes FOR VALUES WITH (MODULUS 4, REMAINDER 3);

-- This is a registry of unique user attributes.
-- Values must be hashed with SHA-256 before storing them.
-- The primary key is the only index we need.
-- An empty team ID basically makes an attribute unique within the project.
-- This table is partitioned by key: it optimizes looking up a single unique attribute by its hash,
-- returning the found user ID. The user ID can then be used to build the user object with
-- the actual attributes.
CREATE TABLE zitadel_nextgen.user_unique_attributes (
    project_id TEXT NOT NULL COLLATE "C"
    , user_id TEXT NOT NULL COLLATE "C"
    , team_id TEXT NOT NULL COLLATE "C" -- empty string if global
    , key TEXT NOT NULL COLLATE "C"
    , value_hash BYTEA NOT NULL -- raw binary SHA-256
    , PRIMARY KEY (project_id, team_id, key, value_hash)
    , FOREIGN KEY (project_id, user_id)
        REFERENCES zitadel_nextgen.users(project_id, id)
        ON DELETE CASCADE
) PARTITION BY HASH (project_id, key);

CREATE TABLE zitadel_nextgen.user_unique_attributes_part_0 PARTITION OF zitadel_nextgen.user_unique_attributes FOR VALUES WITH (MODULUS 2, REMAINDER 0);
CREATE TABLE zitadel_nextgen.user_unique_attributes_part_1 PARTITION OF zitadel_nextgen.user_unique_attributes FOR VALUES WITH (MODULUS 2, REMAINDER 1);

--
-- Data types for user creation (used by example)
--

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE zitadel_nextgen.uniqueness_scope AS ENUM (
    'unspecified',
    'team',
    'global'
);

CREATE TYPE zitadel_nextgen.incoming_user_attribute AS (
    key          TEXT,
    value        JSONB,
    value_hash   BYTEA,
    unique_scope zitadel_nextgen.uniqueness_scope
);

-- +goose StatementBegin
-- This optimizes joining of tables that have matching partition columns.
-- However, there is a small price to pay for the query planner overall.
-- Heads up: this cannot be run in an transaction, probably needs to be moved into it's own setup job later.
DO $$
BEGIN
    EXECUTE format('ALTER DATABASE %I SET enable_partitionwise_join = on', current_database());
    EXECUTE format('ALTER DATABASE %I SET enable_partitionwise_aggregate = on', current_database());
END
$$;
-- +goose StatementEnd

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.user_unique_attributes;
DROP TABLE IF EXISTS zitadel_nextgen.user_attributes;
DROP TABLE IF EXISTS zitadel_nextgen.users;

DROP TYPE IF EXISTS zitadel_nextgen.incoming_user_attribute;
DROP TYPE IF EXISTS zitadel_nextgen.uniqueness_scope;
