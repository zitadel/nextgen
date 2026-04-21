-- This SQL script populates the `zitadel_nextgen` schema with sample data for instances, organizations, users, and user attributes.
-- It creates, 10 instances, each containing 100 organizations, and each organization containing 1,000 users, resulting in a total of 1,000,000 users.
-- For each user, it generates 6 attributes: username, email, email_verified, nickname, address.country, and address.locality.
-- It generates a hierarchical structure of data where each instance contains multiple organizations,
-- and each organization contains multiple users with various attributes.
--
-- It's also a good test on insert performanceo of the model. On my system:
--   Total execution time: 00:01:33.369
-- IMO that's pretty solid for inserting 1 million users with 6 million attributes.

BEGIN;

INSERT INTO zitadel_nextgen.instances (id)
SELECT 
    'inst_' || i AS id
FROM generate_series(1, 10) s(i);

INSERT INTO zitadel_nextgen.organizations (instance_id, id)
SELECT 
    'inst_' || inst_id AS instance_id
    , 'org_' || lpad(org_id::text, 4, '0') AS id
FROM generate_series(1, 10) inst_id
CROSS JOIN generate_series(1, 100) org_id;

INSERT INTO zitadel_nextgen.users (instance_id, organization_id, id, schema_url)
SELECT 
    'inst_' || inst_id
    , 'org_' || lpad(org_id::text, 4, '0')
    , 'usr_' || lpad(((inst_id * 100000) + (org_id * 1000) + user_id)::text, 8, '0')
    , './user.schema.json'
FROM generate_series(1, 10) inst_id
CROSS JOIN generate_series(1, 100) org_id
CROSS JOIN generate_series(1, 1000) user_id;

WITH user_data AS (
    SELECT 
        'inst_' || inst_id AS i_id,
        'org_' || lpad(org_id::text, 4, '0') AS o_id,
        'usr_' || lpad(((inst_id * 100000) + (org_id * 1000) + user_id)::text, 8, '0') AS u_id,
        -- Global counter within an instance (1 to 100,000)
        ((org_id - 1) * 1000) + user_id AS inst_counter,
        -- Counter within an organization (1 to 1,000)
        user_id AS org_counter
    FROM generate_series(1, 10) inst_id
    CROSS JOIN generate_series(1, 100) org_id
    CROSS JOIN generate_series(1, 1000) user_id
)
INSERT INTO zitadel_nextgen.user_attributes 
    (instance_id, organization_id, user_id, key, value, org_unique, global_unique)
-- 1. Username (Global Unique)
SELECT i_id, o_id, u_id, 'username', to_jsonb('U_' || lpad(inst_counter::text, 6, '0')), false, true FROM user_data
UNION ALL
-- 2. Email (Global Unique)
SELECT i_id, o_id, u_id, 'email', to_jsonb('U_' || lpad(inst_counter::text, 6, '0') || '@nextgen.zitadel.com'), false, true FROM user_data
UNION ALL
-- 3. Email Verified (Deterministic toggle)
SELECT i_id, o_id, u_id, 'email_verified', to_jsonb(org_counter % 2 = 0), false, false FROM user_data
UNION ALL
-- 4. Nickname (Org Unique)
SELECT i_id, o_id, u_id, 'nickname', to_jsonb('N_' || lpad(org_counter::text, 4, '0')), true, false FROM user_data
UNION ALL
-- 5. Address Country
SELECT i_id, o_id, u_id, 'address.country', to_jsonb((ARRAY['South Africa', 'Switzerland', 'USA', 'Germany', 'Japan'])[((inst_counter + org_counter) % 5) + 1]), false, false FROM user_data
UNION ALL
-- 6. Address Locality
SELECT i_id, o_id, u_id, 'address.locality', to_jsonb((ARRAY['Hoedspruit', 'Zurich', 'New York', 'Berlin', 'Tokyo'])[((inst_counter + org_counter) % 5) + 1]), false, false FROM user_data;

COMMIT;
