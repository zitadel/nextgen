-- +goose Up
CREATE TABLE zitadel_nextgen.users (
    project_id TEXT COLLATE "C" NOT NULL
    , team_id TEXT COLLATE "C"
    , schema_url TEXT COLLATE "C" NOT NULL
    , id TEXT COLLATE "C" NOT NULL CHECK ( id <> '' )
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, id)
    , CONSTRAINT fk_users_project
        FOREIGN KEY (project_id)
        REFERENCES zitadel_nextgen.projects(id)
        ON DELETE CASCADE
    , FOREIGN KEY (project_id, team_id)
        REFERENCES zitadel_nextgen.teams(project_id, id)
        ON DELETE CASCADE
    , FOREIGN KEY (project_id, schema_url)
        REFERENCES zitadel_nextgen.json_schemas(project_id, url)
        ON DELETE RESTRICT
) PARTITION BY HASH (project_id, id);

-- Index for user cascade deletes scoped by team.
CREATE INDEX idx_users_team_id
    ON zitadel_nextgen.users(project_id, team_id);

CREATE TABLE zitadel_nextgen.users_part_0 PARTITION OF zitadel_nextgen.users FOR VALUES WITH (MODULUS 1, REMAINDER 0);

-- User attributes is EAV store containing all the properties of a user.
-- This is the only table containing PII.
-- It is partitioned by user_id, matching the users table, and therefore optimized to hydrate a user.
CREATE TABLE zitadel_nextgen.user_attributes (
    project_id TEXT COLLATE "C" NOT NULL
    , team_id TEXT COLLATE "C" NOT NULL
    , user_id TEXT COLLATE "C" NOT NULL
    , key TEXT NOT NULL COLLATE "C" CHECK ( key <> '' )

    --JSONB allows for dynamic typing
    , value JSONB NOT NULL CHECK (
        jsonb_typeof(value) <> 'null'
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
    , team_id TEXT NOT NULL COLLATE "C" -- empty string if project-scoped
    , key TEXT NOT NULL COLLATE "C"
    , value_hash BYTEA NOT NULL -- raw binary SHA-256
    , PRIMARY KEY (project_id, team_id, key, value_hash)
    , FOREIGN KEY (project_id, user_id)
        REFERENCES zitadel_nextgen.users(project_id, id)
        ON DELETE CASCADE
) PARTITION BY HASH (project_id, key);

CREATE TABLE zitadel_nextgen.user_unique_attributes_part_0 PARTITION OF zitadel_nextgen.user_unique_attributes FOR VALUES WITH (MODULUS 2, REMAINDER 0);
CREATE TABLE zitadel_nextgen.user_unique_attributes_part_1 PARTITION OF zitadel_nextgen.user_unique_attributes FOR VALUES WITH (MODULUS 2, REMAINDER 1);

-- Dedicated credential tables (not part of the EAV user_attributes store).

CREATE TABLE zitadel_nextgen.user_passwords (
    project_id TEXT COLLATE "C" NOT NULL
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , user_id TEXT COLLATE "C" NOT NULL
    , encoded_hash TEXT NOT NULL CHECK (encoded_hash <> '')
    , change_required BOOLEAN NOT NULL DEFAULT FALSE
    , changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , verification_id TEXT
    , last_successful_check TIMESTAMPTZ
    , failed_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0)
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, id)
    , UNIQUE (project_id, user_id)
    , FOREIGN KEY (project_id, user_id)
        REFERENCES zitadel_nextgen.users(project_id, id)
        ON DELETE CASCADE
);

CREATE TABLE zitadel_nextgen.user_totp (
    project_id TEXT COLLATE "C" NOT NULL
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , user_id TEXT COLLATE "C" NOT NULL
    , secret BYTEA NOT NULL
    , verified_at TIMESTAMPTZ
    , last_successful_check TIMESTAMPTZ
    , failed_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0)
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, id)
    , UNIQUE (project_id, user_id)
    , FOREIGN KEY (project_id, user_id)
        REFERENCES zitadel_nextgen.users(project_id, id)
        ON DELETE CASCADE
);

CREATE TABLE zitadel_nextgen.user_recovery_codes (
    project_id TEXT COLLATE "C" NOT NULL
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , user_id TEXT COLLATE "C" NOT NULL
    , recovery_codes TEXT[] NOT NULL CHECK (cardinality(recovery_codes) > 0)
    , last_successful_check TIMESTAMPTZ
    , failed_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0)
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, id)
    , UNIQUE (project_id, user_id)
    , FOREIGN KEY (project_id, user_id)
        REFERENCES zitadel_nextgen.users(project_id, id)
        ON DELETE CASCADE
);

CREATE TABLE zitadel_nextgen.user_passkeys (
    project_id TEXT COLLATE "C" NOT NULL
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , user_id TEXT COLLATE "C" NOT NULL
    , credential_id TEXT COLLATE "C" NOT NULL CHECK (credential_id <> '')
    , public_key BYTEA NOT NULL
    , aaguid BYTEA
    , attestation_type TEXT
    , transports TEXT[] NOT NULL
    , sign_count BIGINT NOT NULL DEFAULT 0 CHECK (sign_count >= 0)
    , backup_eligible BOOLEAN NOT NULL DEFAULT FALSE
    , backup_state BOOLEAN NOT NULL DEFAULT FALSE
    , name TEXT
    , verified_at TIMESTAMPTZ
    , last_used_at TIMESTAMPTZ
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, id)
    , UNIQUE (project_id, user_id, credential_id)
    , FOREIGN KEY (project_id, user_id)
        REFERENCES zitadel_nextgen.users(project_id, id)
        ON DELETE CASCADE
);

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE zitadel_nextgen.uniqueness_scope AS ENUM (
    'unspecified',
    'team',
    'project'
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
DROP TABLE IF EXISTS zitadel_nextgen.user_passkeys;
DROP TABLE IF EXISTS zitadel_nextgen.user_recovery_codes;
DROP TABLE IF EXISTS zitadel_nextgen.user_totp;
DROP TABLE IF EXISTS zitadel_nextgen.user_passwords;
DROP TABLE IF EXISTS zitadel_nextgen.user_unique_attributes;
DROP TABLE IF EXISTS zitadel_nextgen.user_attributes;
DROP TABLE IF EXISTS zitadel_nextgen.users;

DROP TYPE IF EXISTS zitadel_nextgen.incoming_user_attribute;
DROP TYPE IF EXISTS zitadel_nextgen.uniqueness_scope;
