-- +goose Up
-- Drops the hash partitioning of users and user_attributes and folds the
-- user_unique_attributes registry into user_attributes. Partitioning forced a
-- separate registry: Postgres refuses a unique index on a partitioned table
-- that leaves out a partition column.
--
-- One transaction: the copy locks the tables, which is acceptable while the
-- server runs only in preview with few users.

ALTER TABLE zitadel_nextgen.users RENAME TO users_old;
ALTER INDEX zitadel_nextgen.users_pkey RENAME TO users_old_pkey;
ALTER INDEX zitadel_nextgen.idx_users_lifecycle_owner_team_id RENAME TO idx_users_old_lifecycle_owner_team_id;
ALTER INDEX zitadel_nextgen.idx_users_schema_url RENAME TO idx_users_old_schema_url;
ALTER TABLE zitadel_nextgen.user_attributes RENAME TO user_attributes_old;
ALTER INDEX zitadel_nextgen.user_attributes_pkey RENAME TO user_attributes_old_pkey;
ALTER INDEX zitadel_nextgen.idx_user_attributes_scalar RENAME TO idx_user_attributes_old_scalar;
ALTER INDEX zitadel_nextgen.idx_user_attributes_array_search RENAME TO idx_user_attributes_old_array_search;

CREATE TABLE zitadel_nextgen.users (
    project_id TEXT COLLATE "C" NOT NULL
    , schema_url TEXT COLLATE "C" NOT NULL
    , id TEXT COLLATE "C" NOT NULL CHECK ( id <> '' )
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , lifecycle_owner_team_id TEXT COLLATE "C"
    , status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'deactivated', 'pending_purge'))

    , PRIMARY KEY (project_id, id)
    , CONSTRAINT fk_users_project
        FOREIGN KEY (project_id)
        REFERENCES zitadel_nextgen.projects(id)
        ON DELETE CASCADE
    , CONSTRAINT users_lifecycle_owner_team_fkey
        FOREIGN KEY (project_id, lifecycle_owner_team_id)
        REFERENCES zitadel_nextgen.teams(project_id, id)
        ON DELETE RESTRICT
    , FOREIGN KEY (project_id, schema_url)
        REFERENCES zitadel_nextgen.json_schemas(project_id, url)
        ON DELETE RESTRICT
);

CREATE INDEX idx_users_lifecycle_owner_team_id
    ON zitadel_nextgen.users (project_id, lifecycle_owner_team_id)
    WHERE lifecycle_owner_team_id IS NOT NULL;

CREATE INDEX idx_users_schema_url
    ON zitadel_nextgen.users (project_id, schema_url);

INSERT INTO zitadel_nextgen.users (project_id, schema_url, id, created_at, updated_at, lifecycle_owner_team_id, status)
SELECT project_id, schema_url, id, created_at, updated_at, lifecycle_owner_team_id, status
FROM zitadel_nextgen.users_old;

-- value_hash and unique_team_id are set only for an attribute unique within
-- the project (unique_team_id '') or within a team. value_hash is the raw
-- SHA-256 of the case-folded value, computed in Go.
CREATE TABLE zitadel_nextgen.user_attributes (
    project_id TEXT COLLATE "C" NOT NULL
    , user_id TEXT COLLATE "C" NOT NULL
    , key TEXT NOT NULL COLLATE "C" CHECK ( key <> '' )

    --JSONB allows for dynamic typing
    , value JSONB NOT NULL CHECK (
        jsonb_typeof(value) <> 'null'
    )
    , unique_team_id TEXT COLLATE "C"
    , value_hash BYTEA

    , PRIMARY KEY (project_id, user_id, key)
    , FOREIGN KEY (project_id, user_id)
        REFERENCES zitadel_nextgen.users(project_id, id)
        ON DELETE CASCADE
    -- A hash without a team scope would escape the unique index: NULLs never
    -- collide.
    , CONSTRAINT user_attributes_unique_team_id_check
        CHECK (value_hash IS NULL OR unique_team_id IS NOT NULL)
);

-- General Lookup Index: Only for scalar values
CREATE INDEX idx_user_attributes_scalar
    ON zitadel_nextgen.user_attributes USING btree
    (project_id, key, value, user_id)
    WHERE (jsonb_typeof(value) IN ('string', 'number', 'boolean'));

-- Specialized Array Search Index
CREATE INDEX idx_user_attributes_array_search
    ON zitadel_nextgen.user_attributes
    USING GIN (project_id, key, value)
    WHERE (jsonb_typeof(value) = 'array');

-- Enforces uniqueness and serves the lookup with or without a team scope.
CREATE UNIQUE INDEX idx_user_attributes_unique
    ON zitadel_nextgen.user_attributes (project_id, key, value_hash, unique_team_id)
    WHERE value_hash IS NOT NULL;

INSERT INTO zitadel_nextgen.user_attributes (project_id, user_id, key, value, unique_team_id, value_hash)
SELECT a.project_id, a.user_id, a.key, a.value, u.team_id, u.value_hash
FROM zitadel_nextgen.user_attributes_old a
LEFT JOIN zitadel_nextgen.user_unique_attributes u
    ON u.project_id = a.project_id AND u.user_id = a.user_id AND u.key = a.key;

-- CASCADE drops the foreign keys of the tables referencing users.
DROP TABLE zitadel_nextgen.user_unique_attributes;
DROP TABLE zitadel_nextgen.user_attributes_old;
DROP TABLE zitadel_nextgen.users_old CASCADE;

ALTER TABLE zitadel_nextgen.user_passwords
    ADD CONSTRAINT user_passwords_project_id_user_id_fkey
    FOREIGN KEY (project_id, user_id) REFERENCES zitadel_nextgen.users(project_id, id) ON DELETE CASCADE;
ALTER TABLE zitadel_nextgen.user_totp
    ADD CONSTRAINT user_totp_project_id_user_id_fkey
    FOREIGN KEY (project_id, user_id) REFERENCES zitadel_nextgen.users(project_id, id) ON DELETE CASCADE;
ALTER TABLE zitadel_nextgen.user_recovery_codes
    ADD CONSTRAINT user_recovery_codes_project_id_user_id_fkey
    FOREIGN KEY (project_id, user_id) REFERENCES zitadel_nextgen.users(project_id, id) ON DELETE CASCADE;
ALTER TABLE zitadel_nextgen.user_passkeys
    ADD CONSTRAINT user_passkeys_project_id_user_id_fkey
    FOREIGN KEY (project_id, user_id) REFERENCES zitadel_nextgen.users(project_id, id) ON DELETE CASCADE;
ALTER TABLE zitadel_nextgen.sessions
    ADD CONSTRAINT fk_sessions_user
    FOREIGN KEY (project_id, user_id) REFERENCES zitadel_nextgen.users(project_id, id) ON DELETE CASCADE;
ALTER TABLE zitadel_nextgen.tokens
    ADD CONSTRAINT tokens_project_id_user_id_fkey
    FOREIGN KEY (project_id, user_id) REFERENCES zitadel_nextgen.users(project_id, id) ON DELETE CASCADE;
ALTER TABLE zitadel_nextgen.team_memberships
    ADD CONSTRAINT team_memberships_project_id_user_id_fkey
    FOREIGN KEY (project_id, user_id) REFERENCES zitadel_nextgen.users(project_id, id) ON DELETE RESTRICT;
ALTER TABLE zitadel_nextgen.idp_identity_links
    ADD CONSTRAINT fk_idp_identity_links_user
    FOREIGN KEY (project_id, user_id) REFERENCES zitadel_nextgen.users(project_id, id) ON DELETE CASCADE;

-- A project delete runs its cascades in constraint creation order. Users must
-- go before IdP connections: the user cascade removes the identity links, and
-- fk_idp_identity_links_connection (NO ACTION) refuses a connection delete
-- while a link remains. Re-adding the connection FK makes it newer than
-- fk_users_project again.
ALTER TABLE zitadel_nextgen.idp_connections DROP CONSTRAINT idp_connections_project_id_fkey;
ALTER TABLE zitadel_nextgen.idp_connections
    ADD CONSTRAINT idp_connections_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects(id) ON DELETE CASCADE;

-- Serves the cascade from users. Partial: every session starts with an
-- anonymous token whose user_id is NULL, and the cascade never looks for one.
CREATE INDEX idx_tokens_user
    ON zitadel_nextgen.tokens (project_id, user_id)
    WHERE user_id IS NOT NULL;

-- 000004 turned these on for the partitions.
-- +goose StatementBegin
DO $$
BEGIN
    EXECUTE format('ALTER DATABASE %I RESET enable_partitionwise_join', current_database());
    EXECUTE format('ALTER DATABASE %I RESET enable_partitionwise_aggregate', current_database());
END
$$;
-- +goose StatementEnd

-- +goose Down
-- Restores the partitioned layout of 000004 as later migrations left it.
DROP INDEX zitadel_nextgen.idx_tokens_user;

ALTER TABLE zitadel_nextgen.users RENAME TO users_old;
ALTER INDEX zitadel_nextgen.users_pkey RENAME TO users_old_pkey;
ALTER INDEX zitadel_nextgen.idx_users_lifecycle_owner_team_id RENAME TO idx_users_old_lifecycle_owner_team_id;
ALTER INDEX zitadel_nextgen.idx_users_schema_url RENAME TO idx_users_old_schema_url;
ALTER TABLE zitadel_nextgen.user_attributes RENAME TO user_attributes_old;
ALTER INDEX zitadel_nextgen.user_attributes_pkey RENAME TO user_attributes_old_pkey;
ALTER INDEX zitadel_nextgen.idx_user_attributes_scalar RENAME TO idx_user_attributes_old_scalar;
ALTER INDEX zitadel_nextgen.idx_user_attributes_array_search RENAME TO idx_user_attributes_old_array_search;

CREATE TABLE zitadel_nextgen.users (
    project_id TEXT COLLATE "C" NOT NULL
    , schema_url TEXT COLLATE "C" NOT NULL
    , id TEXT COLLATE "C" NOT NULL CHECK ( id <> '' )
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , lifecycle_owner_team_id TEXT COLLATE "C"
    , status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'deactivated', 'pending_purge'))

    , PRIMARY KEY (project_id, id)
    , CONSTRAINT fk_users_project
        FOREIGN KEY (project_id)
        REFERENCES zitadel_nextgen.projects(id)
        ON DELETE CASCADE
    , CONSTRAINT users_lifecycle_owner_team_fkey
        FOREIGN KEY (project_id, lifecycle_owner_team_id)
        REFERENCES zitadel_nextgen.teams(project_id, id)
        ON DELETE RESTRICT
    , FOREIGN KEY (project_id, schema_url)
        REFERENCES zitadel_nextgen.json_schemas(project_id, url)
        ON DELETE RESTRICT
) PARTITION BY HASH (project_id, id);

CREATE INDEX idx_users_lifecycle_owner_team_id
    ON zitadel_nextgen.users (project_id, lifecycle_owner_team_id)
    WHERE lifecycle_owner_team_id IS NOT NULL;

CREATE INDEX idx_users_schema_url
    ON zitadel_nextgen.users (project_id, schema_url);

CREATE TABLE zitadel_nextgen.users_part_0 PARTITION OF zitadel_nextgen.users FOR VALUES WITH (MODULUS 1, REMAINDER 0);
-- 000038 named the partition index itself.
ALTER INDEX zitadel_nextgen.users_part_0_project_id_schema_url_idx RENAME TO idx_users_part_0_schema_url;

INSERT INTO zitadel_nextgen.users (project_id, schema_url, id, created_at, updated_at, lifecycle_owner_team_id, status)
SELECT project_id, schema_url, id, created_at, updated_at, lifecycle_owner_team_id, status
FROM zitadel_nextgen.users_old;

CREATE TABLE zitadel_nextgen.user_attributes (
    project_id TEXT COLLATE "C" NOT NULL
    , team_id TEXT COLLATE "C" NOT NULL
    , user_id TEXT COLLATE "C" NOT NULL
    , key TEXT NOT NULL COLLATE "C" CHECK ( key <> '' )
    , value JSONB NOT NULL CHECK (
        jsonb_typeof(value) <> 'null'
    )

    , PRIMARY KEY (project_id, user_id, key)
    , FOREIGN KEY (project_id, user_id)
        REFERENCES zitadel_nextgen.users(project_id, id)
        ON DELETE CASCADE
) PARTITION BY HASH (project_id, user_id);

CREATE INDEX idx_user_attributes_scalar
    ON zitadel_nextgen.user_attributes USING btree
    (project_id, key, value, team_id, user_id)
    WHERE (jsonb_typeof(value) IN ('string', 'number', 'boolean'));

CREATE INDEX idx_user_attributes_team_id
    ON zitadel_nextgen.user_attributes USING btree
    (project_id, team_id);

CREATE INDEX idx_user_attributes_array_search
    ON zitadel_nextgen.user_attributes
    USING GIN (project_id, key, value)
    WHERE (jsonb_typeof(value) = 'array');

CREATE TABLE zitadel_nextgen.user_attributes_part_0 PARTITION OF zitadel_nextgen.user_attributes FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE zitadel_nextgen.user_attributes_part_1 PARTITION OF zitadel_nextgen.user_attributes FOR VALUES WITH (MODULUS 4, REMAINDER 1);
CREATE TABLE zitadel_nextgen.user_attributes_part_2 PARTITION OF zitadel_nextgen.user_attributes FOR VALUES WITH (MODULUS 4, REMAINDER 2);
CREATE TABLE zitadel_nextgen.user_attributes_part_3 PARTITION OF zitadel_nextgen.user_attributes FOR VALUES WITH (MODULUS 4, REMAINDER 3);

-- Nothing reads team_id, so '' stands in for the value create wrote.
INSERT INTO zitadel_nextgen.user_attributes (project_id, team_id, user_id, key, value)
SELECT project_id, '', user_id, key, value
FROM zitadel_nextgen.user_attributes_old;

CREATE TABLE zitadel_nextgen.user_unique_attributes (
    project_id TEXT NOT NULL COLLATE "C"
    , user_id TEXT NOT NULL COLLATE "C"
    , team_id TEXT NOT NULL COLLATE "C"
    , key TEXT NOT NULL COLLATE "C"
    , value_hash BYTEA NOT NULL
    , PRIMARY KEY (project_id, team_id, key, value_hash)
    , FOREIGN KEY (project_id, user_id)
        REFERENCES zitadel_nextgen.users(project_id, id)
        ON DELETE CASCADE
) PARTITION BY HASH (project_id, key);

CREATE TABLE zitadel_nextgen.user_unique_attributes_part_0 PARTITION OF zitadel_nextgen.user_unique_attributes FOR VALUES WITH (MODULUS 2, REMAINDER 0);
CREATE TABLE zitadel_nextgen.user_unique_attributes_part_1 PARTITION OF zitadel_nextgen.user_unique_attributes FOR VALUES WITH (MODULUS 2, REMAINDER 1);

INSERT INTO zitadel_nextgen.user_unique_attributes (project_id, user_id, team_id, key, value_hash)
SELECT project_id, user_id, unique_team_id, key, value_hash
FROM zitadel_nextgen.user_attributes_old
WHERE value_hash IS NOT NULL;

DROP TABLE zitadel_nextgen.user_attributes_old;
DROP TABLE zitadel_nextgen.users_old CASCADE;

ALTER TABLE zitadel_nextgen.user_passwords
    ADD CONSTRAINT user_passwords_project_id_user_id_fkey
    FOREIGN KEY (project_id, user_id) REFERENCES zitadel_nextgen.users(project_id, id) ON DELETE CASCADE;
ALTER TABLE zitadel_nextgen.user_totp
    ADD CONSTRAINT user_totp_project_id_user_id_fkey
    FOREIGN KEY (project_id, user_id) REFERENCES zitadel_nextgen.users(project_id, id) ON DELETE CASCADE;
ALTER TABLE zitadel_nextgen.user_recovery_codes
    ADD CONSTRAINT user_recovery_codes_project_id_user_id_fkey
    FOREIGN KEY (project_id, user_id) REFERENCES zitadel_nextgen.users(project_id, id) ON DELETE CASCADE;
ALTER TABLE zitadel_nextgen.user_passkeys
    ADD CONSTRAINT user_passkeys_project_id_user_id_fkey
    FOREIGN KEY (project_id, user_id) REFERENCES zitadel_nextgen.users(project_id, id) ON DELETE CASCADE;
ALTER TABLE zitadel_nextgen.sessions
    ADD CONSTRAINT fk_sessions_user
    FOREIGN KEY (project_id, user_id) REFERENCES zitadel_nextgen.users(project_id, id) ON DELETE CASCADE;
ALTER TABLE zitadel_nextgen.tokens
    ADD CONSTRAINT tokens_project_id_user_id_fkey
    FOREIGN KEY (project_id, user_id) REFERENCES zitadel_nextgen.users(project_id, id) ON DELETE CASCADE;
ALTER TABLE zitadel_nextgen.team_memberships
    ADD CONSTRAINT team_memberships_project_id_user_id_fkey
    FOREIGN KEY (project_id, user_id) REFERENCES zitadel_nextgen.users(project_id, id) ON DELETE RESTRICT;
ALTER TABLE zitadel_nextgen.idp_identity_links
    ADD CONSTRAINT fk_idp_identity_links_user
    FOREIGN KEY (project_id, user_id) REFERENCES zitadel_nextgen.users(project_id, id) ON DELETE CASCADE;

-- Keeps the users cascade ahead of the IdP connections cascade, as in the Up.
ALTER TABLE zitadel_nextgen.idp_connections DROP CONSTRAINT idp_connections_project_id_fkey;
ALTER TABLE zitadel_nextgen.idp_connections
    ADD CONSTRAINT idp_connections_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects(id) ON DELETE CASCADE;

-- +goose StatementBegin
DO $$
BEGIN
    EXECUTE format('ALTER DATABASE %I SET enable_partitionwise_join = on', current_database());
    EXECUTE format('ALTER DATABASE %I SET enable_partitionwise_aggregate = on', current_database());
END
$$;
-- +goose StatementEnd