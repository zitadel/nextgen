-- Full state sync: $3 is the complete desired attribute set. Keys omitted are removed
-- from user_attributes and from user_unique_attributes (or no longer registered when
-- unique_scope is unspecified). Registry rows for keys that stay unique are cleared
-- then re-inserted so value_hash changes stay conflict-free against the registry PK.
-- Final attributes are taken from _input_data (same shape as get_by_id / create).

DEALLOCATE ALL;
PREPARE patch_user_attributes (
    TEXT, -- $1 instance_id
    TEXT, -- $2 user_id (users.id)
    zitadel_nextgen.incoming_user_attribute[] -- $3 full attribute set
) AS

WITH _header AS (
    UPDATE zitadel_nextgen.users u
    SET updated_at = now()
    WHERE u.instance_id = $1
      AND u.id = $2
    RETURNING
        u.instance_id
        , u.id
        , u.organization_id
        , u.schema_url
        , u.created_at
        , u.updated_at
)
, _input_data AS (
    SELECT
        key
        , value
        , value_hash
        , unique_scope
    FROM unnest($3::zitadel_nextgen.incoming_user_attribute[])
)
, _del_registry AS (
    DELETE FROM zitadel_nextgen.user_unique_attributes uua
    WHERE uua.instance_id = $1
      AND uua.user_id = $2
      AND (
            NOT EXISTS (
                SELECT 1
                FROM _input_data d
                WHERE d.key = uua.key
            )
        OR EXISTS (
                SELECT 1
                FROM _input_data d
                WHERE d.key = uua.key
                  AND d.unique_scope = 'unspecified'::zitadel_nextgen.uniqueness_scope
            )
        OR EXISTS (
                SELECT 1
                FROM _input_data d
                WHERE d.key = uua.key
                  AND d.unique_scope IN (
                        'organization'::zitadel_nextgen.uniqueness_scope
                        , 'global'::zitadel_nextgen.uniqueness_scope
                    )
            )
        )
)
, _ins_registry AS (
    INSERT INTO zitadel_nextgen.user_unique_attributes (
        instance_id
        , user_id
        , organization_id
        , key
        , value_hash
    )
    SELECT
        $1
        , $2
        , CASE
            WHEN d.unique_scope = 'global'::zitadel_nextgen.uniqueness_scope THEN ''::text
            ELSE h.organization_id
          END
        , d.key
        , d.value_hash
    FROM _input_data d
    CROSS JOIN _header h
    WHERE d.unique_scope IN (
            'organization'::zitadel_nextgen.uniqueness_scope
            , 'global'::zitadel_nextgen.uniqueness_scope
        )
)
, _del_attrs AS (
    DELETE FROM zitadel_nextgen.user_attributes ua
    WHERE ua.instance_id = $1
      AND ua.user_id = $2
      AND NOT EXISTS (
            SELECT 1
            FROM _input_data d
            WHERE d.key = ua.key
        )
)
, _ins_attrs AS (
    INSERT INTO zitadel_nextgen.user_attributes (
        instance_id
        , organization_id
        , user_id
        , key
        , value
    )
    SELECT
        s.instance_id
        , s.organization_id
        , s.user_id
        , s.key
        , s.value
    FROM (
        SELECT
            h.instance_id
            , h.organization_id
            , h.id AS user_id
            , d.key
            , d.value
        FROM _input_data d
        CROSS JOIN _header h
    ) AS s
    ON CONFLICT (instance_id, user_id, key) DO UPDATE
        SET value = EXCLUDED.value
        , organization_id = EXCLUDED.organization_id
)
SELECT
    h.schema_url
    , h.id
    , h.organization_id
    , h.created_at
    , h.updated_at
    , (
        SELECT array_agg(ROW(d.key, d.value))
        FROM _input_data d
    ) AS attributes
FROM _header h;

/*
EXECUTE patch_user_attributes(
    'inst_1' -- $1 instance_id
    , 'usr_99999999' -- $2 user_id
    , ARRAY[ -- $3 full sync payload (same shape as insert_user)
        ROW('username'::TEXT, '"tester_alpha"'::JSONB, digest('"tester_alpha"'::text, 'md5'), 'global'::TEXT)::zitadel_nextgen.incoming_user_attribute
        , ROW('email'::TEXT, '"tester@zitadel.com"'::JSONB, digest('"tester@zitadel.com"'::text, 'md5'), 'global'::TEXT)::zitadel_nextgen.incoming_user_attribute
        , ROW('email_verified'::TEXT, 'true'::JSONB, NULL::bytea, 'unspecified'::TEXT)::zitadel_nextgen.incoming_user_attribute
        , ROW('nickname'::TEXT, '"TheAlpha"'::JSONB, digest('"TheAlpha"'::text, 'md5'), 'organization'::TEXT)::zitadel_nextgen.incoming_user_attribute
        , ROW('address.country'::TEXT, '"Netherlands"'::JSONB, NULL::bytea, 'unspecified'::TEXT)::zitadel_nextgen.incoming_user_attribute
        , ROW('address.locality'::TEXT, '"Amsterdam"'::JSONB, NULL::bytea, 'unspecified'::TEXT)::zitadel_nextgen.incoming_user_attribute
    ]
);
*/
