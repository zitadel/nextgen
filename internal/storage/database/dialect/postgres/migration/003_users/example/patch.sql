DEALLOCATE ALL;
PREPARE patch_user (
    TEXT,   -- $1 instance_id
    , TEXT  -- $2 user_id (users.id)
    , zitadel_nextgen.incoming_user_attribute[] -- $3 upsert attribute set (op: add, replace)
    ,TEXT[] -- $4 attributes to delete by key (op: remove)
) AS

WITH _header AS (
    UPDATE zitadel_nextgen.users
    SET updated_at = now()
    WHERE instance_id = $1 AND id = $2
    RETURNING organization_id, schema_url, created_at, updated_at
),
_input_upsert AS (
    SELECT key, value, value_hash, unique_scope
    FROM unnest($3::zitadel_nextgen.incoming_user_attribute[])
),
-- We MUST delete the old hash if:
--   a) The key is in the delete list ($4)
--   b) The key is being updated in the upsert list ($3) (to avoid self-collision)
_clear_registry AS (
    DELETE FROM zitadel_nextgen.user_unique_attributes
    WHERE instance_id = $1 
      AND user_id = $2
      AND (
          key = ANY($4) 
          OR key IN (SELECT key FROM _input_upsert)
      )
),
_ins_registry AS (
    INSERT INTO zitadel_nextgen.user_unique_attributes (
        instance_id, user_id, organization_id, key, value_hash
    )
    SELECT $1, $2, CASE WHEN unique_scope = 'global' THEN '' ELSE h.organization_id END, key, value_hash
    FROM _input_upsert, _header h
    WHERE unique_scope <> 'unspecified'
),
_del_attrs AS (
    DELETE FROM zitadel_nextgen.user_attributes
    WHERE instance_id = $1 AND user_id = $2 AND key = ANY($4)
),
_upsert_attrs AS (
    INSERT INTO zitadel_nextgen.user_attributes (instance_id, organization_id, user_id, key, value)
    SELECT $1, h.organization_id, $2, i.key, i.value
    FROM _input_upsert i, _header h
    ON CONFLICT (instance_id, user_id, key) DO UPDATE 
    SET value = EXCLUDED.value
)
-- Final Full-State Return
-- State changes in the CTEs are not yet applied to the tables.
-- We need to build the final state from the CTE outputs.
SELECT 
    h.schema_url, $2 as id, h.organization_id, h.created_at, h.updated_at,
    (
        SELECT array_agg(ROW(final.key, final.value))
        FROM (
            -- Attributes that were NOT touched by the patch
            SELECT key, value FROM zitadel_nextgen.user_attributes
            WHERE instance_id = $1 AND user_id = $2
              AND key NOT IN (SELECT key FROM _input_upsert)
              AND key <> ALL($4)
            UNION ALL
            -- Attributes that were newly added or updated
            SELECT key, value FROM _input_upsert
        ) final
    ) AS attributes
FROM _header h;
