CREATE TABLE zitadel_nextgen.users (
    instance_id TEXT COLLATE "C" NOT NULL
    , organization_id TEXT COLLATE "C" NOT NULL
    , id TEXT COLLATE "C" NOT NULL CHECK ( id <> '' )
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , schema_url TEXT COLLATE "C" NOT NULL CHECK ( schema_url <> '' )

    , PRIMARY KEY (instance_id, id)
    , FOREIGN KEY (instance_id, organization_id)
        REFERENCES zitadel_nextgen.organizations(instance_id, id)
        ON DELETE CASCADE
) PARTITION BY HASH (instance_id, id);

-- Index for user cascade deletes.
CREATE INDEX idx_users_organization_id
    ON zitadel_nextgen.users(instance_id, organization_id);

CREATE TABLE zitadel_nextgen.users_part_0 PARTITION OF zitadel_nextgen.users FOR VALUES WITH (MODULUS 1, REMAINDER 0);

-- This optimizes joining of tables that have matching partition columns.
-- However, there is a small price to pay for the query planner overall.
-- Heads up: this cannot be run in an transaction, probably needs to be moved into it's own setup job later.
DO $$
BEGIN
    EXECUTE format('ALTER DATABASE %I SET enable_partitionwise_join = on', current_database());
    EXECUTE format('ALTER DATABASE %I SET enable_partitionwise_aggregate = on', current_database());
END
$$;

-- User attributes is EAV store containing all the properties of a user.
-- This is the only table containing PII.
-- It is partitioned by user_id, matching the users table, and therefore optimized to hydrate a user.
-- A couple if indexes are defined for general searching and listing of users.
CREATE TABLE zitadel_nextgen.user_attributes (
    instance_id TEXT COLLATE "C" NOT NULL
    , organization_id TEXT COLLATE "C" NOT NULL
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

    , PRIMARY KEY (instance_id, user_id, key)
    , FOREIGN KEY (instance_id, user_id)
        REFERENCES zitadel_nextgen.users(instance_id, id)
        ON DELETE CASCADE
) PARTITION BY HASH (instance_id, user_id);

-- General Lookup Index: Only for scalar values
CREATE INDEX idx_user_attributes_scalar
    ON zitadel_nextgen.user_attributes USING btree
    (instance_id, key, value, organization_id, user_id)
    WHERE (jsonb_typeof(value) IN ('string', 'number', 'boolean'));

CREATE INDEX idx_user_attributes_organization_id
    ON zitadel_nextgen.user_attributes USING btree
    (instance_id, organization_id);

-- Specialized Array Search Index
-- Uses GIN for containment (@>), but B-Tree logic for the prefix columns
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE INDEX idx_user_attributes_array_search
    ON zitadel_nextgen.user_attributes 
    USING GIN (instance_id, key, value)
    WHERE (jsonb_typeof(value) = 'array');

CREATE TABLE zitadel_nextgen.user_attributes_part_0 PARTITION OF zitadel_nextgen.user_attributes FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE zitadel_nextgen.user_attributes_part_1 PARTITION OF zitadel_nextgen.user_attributes FOR VALUES WITH (MODULUS 4, REMAINDER 1);
CREATE TABLE zitadel_nextgen.user_attributes_part_2 PARTITION OF zitadel_nextgen.user_attributes FOR VALUES WITH (MODULUS 4, REMAINDER 2);
CREATE TABLE zitadel_nextgen.user_attributes_part_3 PARTITION OF zitadel_nextgen.user_attributes FOR VALUES WITH (MODULUS 4, REMAINDER 3);

-- This is a registry of unique user attributes.
-- Values must be hashed with SHA-256 before storing them.
-- The primary key is the only index we need.
-- An empty organization ID basically makes an attribute unique within the instance.
-- This table is partitioned by key: it optimizes looking up a single unique attribute by it's hash,
-- returning the found user ID. The user ID can then be used the build the user object with
-- the actual attributes.
CREATE TABLE zitadel_nextgen.user_unique_attributes (
    instance_id TEXT NOT NULL COLLATE "C"
    , user_id TEXT NOT NULL COLLATE "C"
    , organization_id TEXT NOT NULL COLLATE "C" -- empty string if global
    , key TEXT NOT NULL COLLATE "C"
    , value_hash BYTEA NOT NULL -- raw binary SHA-256
    , PRIMARY KEY (instance_id, organization_id, key, value_hash)
    , FOREIGN KEY (instance_id, user_id)
        REFERENCES zitadel_nextgen.users(instance_id, id)
        ON DELETE CASCADE
) PARTITION BY HASH (instance_id, key);

-- We can use less partitions here: the table is really slim and I expect there's usually only 1 or 2 unique attributes per user, like username and email.
CREATE TABLE zitadel_nextgen.user_unique_attributes_part_0 PARTITION OF zitadel_nextgen.user_unique_attributes FOR VALUES WITH (MODULUS 2, REMAINDER 0);
CREATE TABLE zitadel_nextgen.user_unique_attributes_part_1 PARTITION OF zitadel_nextgen.user_unique_attributes FOR VALUES WITH (MODULUS 2, REMAINDER 1);

--
-- Data types for user creation (used by example)
--

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE zitadel_nextgen.uniqueness_scope AS ENUM (
    'unspecified', 
    'organization', 
    'global'
);

CREATE TYPE zitadel_nextgen.incoming_user_attribute AS (
    key          TEXT,
    value        JSONB,
    value_hash   BYTEA, -- Passed from Go
    unique_scope zitadel_nextgen.uniqueness_scope
);
