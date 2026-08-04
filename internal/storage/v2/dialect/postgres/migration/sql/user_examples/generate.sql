-- Test data bootstrap (adapt to migrated schema naming).
--
-- Partition layout:
-- 1. users: partitioned by HASH (project_id, id)
-- 2. user_attributes: partitioned by HASH (project_id, user_id)
-- 3. user_unique_attributes: partitioned by HASH (project_id, key)

INSERT INTO zitadel_nextgen.projects (id, name, preview_origins)
SELECT
    'proj_' || inst_id AS id,
    'project_' || inst_id AS name,
    '{}'::text[] AS preview_origins
FROM generate_series(1, 10) AS s(inst_id);

INSERT INTO zitadel_nextgen.teams (project_id, id, name)
SELECT
    'proj_' || inst_id AS project_id,
    'team_' || inst_id AS id,
    'team_' || inst_id AS name
FROM generate_series(1, 10) AS s(inst_id);

INSERT INTO zitadel_nextgen.json_schemas (project_id, url, payload)
SELECT
    p.id AS project_id,
    './user.schema.json',
    '{}' ::json
FROM zitadel_nextgen.projects p;

WITH seeded AS (
    SELECT
        t.project_id,
        t.id AS team_id,
        'user_' || substr(md5(random()::text || clock_timestamp()::text), 1, 8) AS user_id
    FROM zitadel_nextgen.teams t
)
INSERT INTO zitadel_nextgen.users (project_id, id, schema_url, lifecycle_owner_team_id, status)
SELECT project_id, user_id, './user.schema.json', NULL, 'active'
FROM seeded;

INSERT INTO zitadel_nextgen.team_memberships (project_id, team_id, user_id, status)
SELECT project_id, team_id, user_id, 'active'
FROM seeded;

-- Populate attributes + uniqueness registry omitted here; prefer create.sql CTE flows in application code.
