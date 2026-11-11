DEALLOCATE ALL;

PREPARE list_users (TEXT, TEXT, TEXT[], TEXT[], TEXT[]) AS
WITH unique_filters AS (
    SELECT DISTINCT key, value_text
    FROM unnest($3, $4) AS f(key TEXT, value_text TEXT)
),
matching_ids AS (
    SELECT p.user_id
    FROM unique_filters f
    JOIN zitadel_nextgen.user_attributes p
      ON p.project_id = $1
      AND p.key = f.key
      AND p.value = f.value_text::jsonb
    WHERE ($2::text IS NULL OR p.team_id IS NOT DISTINCT FROM $2::text)
      AND jsonb_typeof(p.value) IN ('string', 'number', 'boolean')
    GROUP BY p.user_id
    HAVING COUNT(*) = (SELECT COUNT(*) FROM unique_filters)
)
SELECT
    u.schema_url, u.id, u.lifecycle_owner_team_id, u.status, u.created_at, u.updated_at,
    (
      SELECT array_agg(ROW(a.key, a.value))
      FROM zitadel_nextgen.user_attributes a
      WHERE a.project_id = u.project_id
        AND a.user_id = u.id
        AND ($5 IS NULL OR a.key = ANY($5))
    ) AS attributes
FROM matching_ids m
JOIN zitadel_nextgen.users u
    ON u.project_id = $1
    AND u.id = m.user_id;
