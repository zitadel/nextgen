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
) PARTITION BY HASH (instance_id);


-- Index for user cascade deletes.
CREATE INDEX idx_users_organization_id
    ON zitadel_nextgen.users(instance_id, organization_id);

CREATE TABLE zitadel_nextgen.users_part_0 PARTITION OF zitadel_nextgen.users FOR VALUES WITH (MODULUS 1, REMAINDER 0);

CREATE TABLE zitadel_nextgen.user_attributes (
    instance_id TEXT COLLATE "C" NOT NULL
    , organization_id TEXT COLLATE "C" NOT NULL
    , user_id TEXT COLLATE "C" NOT NULL
    , key TEXT NOT NULL COLLATE "C" CHECK ( key <> '' )
    , value JSONB NOT NULL --JSONB allows for dynamic typing
    , org_unique BOOLEAN NOT NULL DEFAULT false
    , global_unique BOOLEAN NOT NULL DEFAULT false

    , PRIMARY KEY (instance_id, user_id, key)
    , FOREIGN KEY (instance_id, user_id)
        REFERENCES zitadel_nextgen.users(instance_id, id)
        ON DELETE CASCADE

    , CONSTRAINT check_unique_scalar CHECK (
        -- 1. Prevent 'null'::jsonb values.
        jsonb_typeof(value) <> 'null' 
        AND value <> '[]'::jsonb
        AND value <> '{}'::jsonb
        AND value <> '""'::jsonb

        -- 2. If it's a unique attribute, it MUST be a scalar
        AND ( 
            (org_unique = false AND global_unique = false) 
            OR 
            jsonb_typeof(value) IN ('string', 'number', 'boolean')
        )
    )
) PARTITION BY HASH (instance_id);

-- Unique Org Index: Only for scalar values
CREATE UNIQUE INDEX idx_user_attributes_org_unique
    ON zitadel_nextgen.user_attributes USING btree
    (instance_id, organization_id, key, value, org_unique)
    INCLUDE(user_id)
    WHERE (org_unique AND jsonb_typeof(value) IN ('string', 'number', 'boolean'));

-- Unique Global Index: Only for scalar values
CREATE UNIQUE INDEX idx_user_attributes_global_unique
    ON zitadel_nextgen.user_attributes USING btree
    (instance_id, key, value, global_unique)
    INCLUDE(user_id)
    WHERE (global_unique AND jsonb_typeof(value) IN ('string', 'number', 'boolean'));

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
