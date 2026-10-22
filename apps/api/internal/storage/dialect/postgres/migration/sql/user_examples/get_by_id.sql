/*
DEALLOCATE ALL;
PREPARE get_user (TEXT, TEXT) AS
*/
SELECT
    u.schema_url,
    u.id,
    u.lifecycle_owner_team_id,
    u.status,
    u.created_at,
    u.updated_at,
    (
        SELECT array_agg(ROW(a.key, a.value))
        FROM zitadel_nextgen.user_attributes a
        WHERE a.project_id = u.project_id
          AND a.user_id = u.id
    ) AS attributes
FROM zitadel_nextgen.users u
WHERE u.project_id = $1
  AND u.id = $2;
