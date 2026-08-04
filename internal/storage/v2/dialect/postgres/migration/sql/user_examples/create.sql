/*
DEALLOCATE ALL;
PREPARE insert_user (
    TEXT, -- $1 project_id
    TEXT, -- $2 schema_url
    TEXT, -- $3 id
    TEXT, -- $4 attribute team scope (nullable; seeds membership + team-scoped uniqueness)
    zitadel_nextgen.incoming_user_attribute[] -- $5 Typed Array
) AS
*/

WITH _user_header AS (
    INSERT INTO zitadel_nextgen.users (
        project_id, schema_url, id, lifecycle_owner_team_id, status
    )
    VALUES ($1, $2, $3, NULL, 'active')
    RETURNING project_id, id, lifecycle_owner_team_id, status, schema_url, created_at, updated_at
),
_membership AS (
    INSERT INTO zitadel_nextgen.team_memberships (project_id, team_id, user_id, status)
    SELECT $1, $4, $3, 'active'
    WHERE $4 IS NOT NULL AND $4 <> ''
),
_input_data AS (
    SELECT key, value, value_hash, unique_scope
    FROM unnest($5::zitadel_nextgen.incoming_user_attribute[])
),
_registry AS (
    INSERT INTO zitadel_nextgen.user_unique_attributes (
        project_id, user_id, team_id, key, value_hash
    )
    SELECT
        $1, $3,
        CASE WHEN unique_scope = 'project' THEN ''::text ELSE $4 END,
        key, value_hash
    FROM _input_data
    WHERE unique_scope <> 'unspecified'
),
_attributes AS (
    INSERT INTO zitadel_nextgen.user_attributes (project_id, team_id, user_id, key, value)
    SELECT $1, $4, $3, key, value
    FROM _input_data
)
SELECT
    u.schema_url, u.id, u.lifecycle_owner_team_id, u.status, u.created_at, u.updated_at,
    (
        SELECT array_agg(ROW(i.key, i.value))
        FROM _input_data i
    ) AS attributes
FROM _user_header u;

/*
EXECUTE insert_user(
    'proj_1'
    , './user.schema.json'
    , 'user_99999999'
    , 'team_0001'
, ARRAY[
        ROW('username'::TEXT,           '"tester_alpha"'::JSONB,        digest('"tester_alpha"'::text, 'md5'),          'project'::TEXT)::zitadel_nextgen.incoming_user_attribute
        , ROW('email'::TEXT,            '"tester@zitadel.com"'::JSONB,  digest('"tester@zitadel.com"'::text, 'md5'),    'project'::TEXT)::zitadel_nextgen.incoming_user_attribute
        , ROW('email_verified'::TEXT,   'true'::JSONB,                  null,                                              'unspecified'::TEXT)::zitadel_nextgen.incoming_user_attribute
        , ROW('nickname'::TEXT,         '"TheAlpha"'::JSONB,            digest('"TheAlpha"'::text, 'md5'),              'organization'::TEXT)::zitadel_nextgen.incoming_user_attribute
        , ROW('address.country'::TEXT,  '"Netherlands"'::JSONB,         null,                                              'unspecified'::TEXT)::zitadel_nextgen.incoming_user_attribute
        , ROW('address.locality'::TEXT, '"Amsterdam"'::JSONB,           null,                                              'unspecified'::TEXT)::zitadel_nextgen.incoming_user_attribute
    ]
);
*/
