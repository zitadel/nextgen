DEALLOCATE ALL;

PREPARE get_user (TEXT, TEXT) AS
SELECT 
    u.schema_url, 
    u.id, 
    u.organization_id, 
    u.created_at, 
    u.updated_at,
    (
        SELECT array_agg(ROW(a.key, a.value))
        FROM zitadel_nextgen.user_attributes a
        WHERE a.instance_id = u.instance_id 
          AND a.user_id = u.id
    ) AS attributes
FROM zitadel_nextgen.users u
WHERE u.instance_id = $1
  AND u.id = $2;

EXECUTE get_user('inst_1', 'usr_00101002');
