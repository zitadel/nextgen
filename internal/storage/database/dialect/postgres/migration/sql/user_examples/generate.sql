-- Test data bootstrap (adapt to migrated schema naming).
--
-- Partition layout:
-- 1. users: partitioned by HASH (project_id, id)
-- 2. user_attributes: partitioned by HASH (project_id, user_id)
-- 3. user_unique_attributes: partitioned by HASH (project_id, key)

INSERT INTO zitadel_nextgen.projects (id)
SELECT
    'proj_' || inst_id AS id
FROM generate_series(1, 10) AS s(inst_id);

INSERT INTO zitadel_nextgen.teams (project_id, id)
SELECT
    'proj_' || inst_id AS project_id,
    'team_' || inst_id AS id
FROM generate_series(1, 10) AS s(inst_id);

INSERT INTO zitadel_nextgen.json_schemas (project_id, url, payload)
SELECT
    p.id AS project_id,
    './user.schema.json',
    '{}' ::json
FROM zitadel_nextgen.projects p;

INSERT INTO zitadel_nextgen.users (project_id, team_id, id, schema_url)
SELECT
    t.project_id,
    t.id,
    'usr_' || substr(md5(random()::text || clock_timestamp()::text), 1, 8),
    './user.schema.json'
FROM zitadel_nextgen.teams t;

-- Populate attributes + uniqueness registry omitted here; prefer create.sql CTE flows in application code.
