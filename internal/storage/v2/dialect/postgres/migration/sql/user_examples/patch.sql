/*
DEALLOCATE ALL;
PREPARE patch_user (
    TEXT -- $1 project_id
    , TEXT -- $2 user_id (users.id)
    , zitadel_nextgen.incoming_user_attribute[] -- $3 upsert attribute set (op: add, replace)
    , TEXT[] -- $4 attributes to delete by key (op: remove)
) AS
*/

WITH _header AS (
    UPDATE zitadel_nextgen.users
    SET updated_at = now()
    WHERE project_id = $1 AND id = $2
    RETURNING project_id, id, lifecycle_owner_team_id, status, schema_url, created_at, updated_at
),
_scope AS (
    SELECT
        h.*
        , COALESCE((
            SELECT m.team_id
            FROM zitadel_nextgen.team_memberships m
            WHERE m.project_id = h.project_id
              AND m.user_id = h.id
              AND m.status = 'active'
            ORDER BY m.created_at
            LIMIT 1
        ), '')::text AS attr_team_id
    FROM _header h
),
_input_upsert AS (
    SELECT key, value, value_hash, unique_scope
    FROM unnest($3::zitadel_nextgen.incoming_user_attribute[])
),
_clear_registry AS (
    DELETE FROM zitadel_nextgen.user_unique_attributes
    WHERE project_id = $1
      AND user_id = $2
      AND (
          key = ANY($4)
          OR key IN (SELECT key FROM _input_upsert)
      )
),
_ins_registry AS (
    INSERT INTO zitadel_nextgen.user_unique_attributes (
        project_id, user_id, team_id, key, value_hash
    )
    SELECT $1, $2, CASE WHEN unique_scope = 'project' THEN '' ELSE h.attr_team_id END, key, value_hash
    FROM _input_upsert, _scope h
    WHERE unique_scope <> 'unspecified'
),
_del_attrs AS (
    DELETE FROM zitadel_nextgen.user_attributes
    WHERE project_id = $1 AND user_id = $2 AND key = ANY($4)
    RETURNING key
),
_upsert_attrs AS (
    INSERT INTO zitadel_nextgen.user_attributes (project_id, team_id, user_id, key, value)
    SELECT $1, h.attr_team_id, $2, i.key, i.value
    FROM _input_upsert i, _scope h
    ON CONFLICT (project_id, user_id, key) DO UPDATE
    SET value = EXCLUDED.value
    RETURNING key
),
_del_attrs_count AS (
    SELECT count(*)::bigint AS deleted_attributes
    FROM _del_attrs
),
_upsert_attrs_count AS (
    SELECT count(*)::bigint AS upserted_attributes
    FROM _upsert_attrs
)
SELECT
    h.schema_url, $2 as id, h.lifecycle_owner_team_id, h.status, h.created_at, h.updated_at,
    (
        SELECT array_agg(ROW(final.key, final.value))
        FROM (
            SELECT key, value FROM zitadel_nextgen.user_attributes
            WHERE project_id = $1 AND user_id = $2
              AND key NOT IN (SELECT key FROM _input_upsert)
              AND key <> ALL($4)
            UNION ALL
            SELECT key, value FROM _input_upsert
        ) final
    ) AS attributes,
    dac.deleted_attributes,
    uac.upserted_attributes
FROM _scope h
CROSS JOIN _del_attrs_count dac
CROSS JOIN _upsert_attrs_count uac;
