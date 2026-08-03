-- Full state sync: $3 is the complete desired attribute set.
-- Registry reconciliation is diff-based: rows absent from desired unique state are
-- deleted, while desired rows are UPSERTed with unchanged rows excluded from writes.
-- Attribute reconciliation is also minimal-write: missing keys are deleted, inserts
-- happen for new keys, and conflict updates run only when values actually changed.
-- Final attributes are taken from _input_data (same model as get_by_id / create).

/*
DEALLOCATE ALL;
PREPARE put_user (
    TEXT, -- $1 project_id
    TEXT, -- $2 user_id (users.id)
    zitadel_nextgen.incoming_user_attribute[] -- $3 full attribute set
) AS
*/

WITH _header AS (
    UPDATE zitadel_nextgen.users u
    SET updated_at = now()
    WHERE u.project_id = $1
      AND u.id = $2
    RETURNING
        u.project_id
        , u.id
        , u.lifecycle_owner_team_id
        , u.status
        , u.schema_url
        , u.created_at
        , u.updated_at
)
, _scope AS (
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
)
, _input_data AS (
    SELECT
        key
        , value
        , value_hash
        , unique_scope
    FROM unnest($3::zitadel_nextgen.incoming_user_attribute[])
)
, _desired_registry AS (
    SELECT
        h.project_id
        , h.id AS user_id
        , CASE
            WHEN d.unique_scope = 'project'::zitadel_nextgen.uniqueness_scope THEN ''::text
            ELSE h.attr_team_id
          END AS team_id
        , d.key
        , d.value_hash
    FROM _input_data d
    CROSS JOIN _scope h
    WHERE d.unique_scope IN (
            'team'::zitadel_nextgen.uniqueness_scope
            , 'project'::zitadel_nextgen.uniqueness_scope
        )
      AND d.value_hash IS NOT NULL
)
, _del_registry AS (
    DELETE FROM zitadel_nextgen.user_unique_attributes uua
    WHERE uua.project_id = $1
      AND uua.user_id = $2
      AND NOT EXISTS (
            SELECT 1
            FROM _desired_registry dr
            WHERE dr.project_id = uua.project_id
              AND dr.user_id = uua.user_id
              AND dr.team_id = uua.team_id
              AND dr.key = uua.key
              AND dr.value_hash = uua.value_hash
        )
)
, _ins_registry AS (
    INSERT INTO zitadel_nextgen.user_unique_attributes (
        project_id
        , user_id
        , team_id
        , key
        , value_hash
    )
    SELECT
        dr.project_id
        , dr.user_id
        , dr.team_id
        , dr.key
        , dr.value_hash
    FROM _desired_registry dr
    WHERE NOT EXISTS (
        SELECT 1
        FROM zitadel_nextgen.user_unique_attributes uua
        WHERE uua.project_id = dr.project_id
            AND uua.user_id = dr.user_id
            AND uua.team_id = dr.team_id
            AND uua.key = dr.key
            AND uua.value_hash = dr.value_hash
    )
)
, _del_attrs AS (
    DELETE FROM zitadel_nextgen.user_attributes ua
    WHERE ua.project_id = $1
      AND ua.user_id = $2
      AND NOT EXISTS (
            SELECT 1
            FROM _input_data d
            WHERE d.key = ua.key
        )
    RETURNING ua.key
)
, _ins_attrs AS (
    INSERT INTO zitadel_nextgen.user_attributes (
        project_id
        , team_id
        , user_id
        , key
        , value
    )
    SELECT
        s.project_id
        , s.team_id
        , s.user_id
        , s.key
        , s.value
    FROM (
        SELECT
            h.project_id
            , h.attr_team_id AS team_id
            , h.id AS user_id
            , d.key
            , d.value
        FROM _input_data d
        CROSS JOIN _scope h
    ) AS s
    WHERE NOT EXISTS (
            SELECT 1
            FROM zitadel_nextgen.user_attributes ua
            WHERE ua.project_id = s.project_id
              AND ua.user_id = s.user_id
              AND ua.key = s.key
              AND ua.team_id IS NOT DISTINCT FROM s.team_id
              AND ua.value = s.value
        )
    ON CONFLICT (project_id, user_id, key) DO UPDATE
        SET value = EXCLUDED.value
        , team_id = EXCLUDED.team_id
    WHERE zitadel_nextgen.user_attributes.value IS DISTINCT FROM EXCLUDED.value
       OR zitadel_nextgen.user_attributes.team_id IS DISTINCT FROM EXCLUDED.team_id
    RETURNING key
)
, _del_attrs_count AS (
    SELECT count(*)::bigint AS deleted_attributes
    FROM _del_attrs
)
, _upsert_attrs_count AS (
    SELECT count(*)::bigint AS upserted_attributes
    FROM _ins_attrs
)
SELECT
    h.schema_url
    , h.id
    , h.lifecycle_owner_team_id
    , h.status
    , h.created_at
    , h.updated_at
    , (
        SELECT array_agg(ROW(d.key, d.value))
        FROM _input_data d
    ) AS attributes
    , dac.deleted_attributes
    , uac.upserted_attributes
FROM _scope h
CROSS JOIN _del_attrs_count dac
CROSS JOIN _upsert_attrs_count uac;

/*
EXECUTE put_user(...);
*/
