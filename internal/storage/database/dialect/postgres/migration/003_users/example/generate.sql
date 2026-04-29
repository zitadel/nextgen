-- This SQL script populates the zitadel_nextgen schema.
-- It reflects the new architecture:
-- 1. users: partitioned by HASH (project_id, id)
-- 2. user_attributes: partitioned by HASH (project_id, user_id)
-- 3. user_unique_attributes: partitioned by HASH (project_id, key)

BEGIN;

-- 1. Populate Projects
INSERT INTO zitadel_nextgen.projects (id)
SELECT 'inst_' || i AS id
FROM generate_series(1, 10) s(i);

-- 2. Populate Teams
INSERT INTO zitadel_nextgen.teams (project_id, id)
SELECT 
    'inst_' || inst_id AS project_id
    , 'org_' || lpad(org_id::text, 4, '0') AS id
FROM generate_series(1, 10) inst_id
CROSS JOIN generate_series(1, 100) org_id;

-- 3. Populate Users
INSERT INTO zitadel_nextgen.users (project_id, team_id, id, schema_url)
SELECT 
    'inst_' || inst_id
    , 'org_' || lpad(org_id::text, 4, '0')
    , 'usr_' || lpad(((inst_id * 100000) + (org_id * 1000) + user_id)::text, 8, '0')
    , './user.schema.json'
FROM generate_series(1, 10) inst_id
CROSS JOIN generate_series(1, 100) org_id
CROSS JOIN generate_series(1, 1000) user_id;

-- CTE to generate values for both attribute tables
WITH user_data AS (
    SELECT 
        'inst_' || inst_id AS i_id,
        'org_' || lpad(org_id::text, 4, '0') AS o_id,
        'usr_' || lpad(((inst_id * 100000) + (org_id * 1000) + user_id)::text, 8, '0') AS u_id,
        ((org_id - 1) * 1000) + user_id AS inst_counter,
        user_id AS org_counter
    FROM generate_series(1, 10) inst_id
    CROSS JOIN generate_series(1, 100) org_id
    CROSS JOIN generate_series(1, 1000) user_id
),
expanded_attributes AS (
    -- 1. Username (Global Unique)
    SELECT i_id, o_id, u_id, 'username' as k, to_jsonb('U_' || lpad(inst_counter::text, 6, '0')) as v, true as is_global, false as is_org FROM user_data
    UNION ALL
    -- 2. Email (Global Unique)
    SELECT i_id, o_id, u_id, 'email', to_jsonb('U_' || lpad(inst_counter::text, 6, '0') || '@nextgen.zitadel.com'), true, false FROM user_data
    UNION ALL
    -- 3. Email Verified (Non-unique)
    SELECT i_id, o_id, u_id, 'email_verified', to_jsonb(org_counter % 2 = 0), false, false FROM user_data
    UNION ALL
    -- 4. Nickname (Org Unique)
    SELECT i_id, o_id, u_id, 'nickname', to_jsonb('N_' || lpad(org_counter::text, 4, '0')), false, true FROM user_data
    UNION ALL
    -- 5. Address Country (Non-unique)
    SELECT i_id, o_id, u_id, 'address.country', to_jsonb((ARRAY['South Africa', 'Switzerland', 'USA', 'Germany', 'Japan'])[((inst_counter + org_counter) % 5) + 1]), false, false FROM user_data
    UNION ALL
    -- 6. Address Locality (Non-unique)
    SELECT i_id, o_id, u_id, 'address.locality', to_jsonb((ARRAY['Hoedspruit', 'Zurich', 'New York', 'Berlin', 'Tokyo'])[((inst_counter + org_counter) % 5) + 1]), false, false FROM user_data
)
-- 4. Insert into the main Attribute Data table (partitioned for co-location)
, insert_data AS (
    INSERT INTO zitadel_nextgen.user_attributes (project_id, team_id, user_id, key, value)
    SELECT i_id, o_id, u_id, k, v FROM expanded_attributes
)
-- 5. Insert into the Uniqueness Registry (partitioned for constraint enforcement)
INSERT INTO zitadel_nextgen.user_unique_attributes 
    (project_id, team_id, key, value_hash, user_id)
SELECT 
    i_id, 
    CASE WHEN is_global THEN '' ELSE o_id END, -- empty string for global, actual org for org-scoped
    k, 
    digest(v::text, 'md5'), -- using MD5 for a compact unique string index
    u_id
FROM expanded_attributes
WHERE is_global OR is_org; -- Only registry attributes that need uniqueness enforcement

COMMIT;
