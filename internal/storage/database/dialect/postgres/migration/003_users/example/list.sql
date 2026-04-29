DEALLOCATE ALL;

PREPARE list_users (TEXT, TEXT, RECORD[], TEXT[]) AS
WITH unique_filters AS (
    -- Deduplicate input filters immediately
    SELECT DISTINCT key, value 
    FROM unnest($3) AS f(key TEXT, value JSONB)
),
matching_ids AS (
    SELECT p.user_id
    FROM unique_filters f
    JOIN zitadel_nextgen.user_attributes p 
      ON p.project_id = $1
      AND p.key = f.key
      AND p.value = f.value
    WHERE ($2 IS NULL OR p.team_id = $2)
      AND jsonb_typeof(p.value) IN ('string', 'number', 'boolean')
    GROUP BY p.user_id
    -- Compare found matches against the deduplicated requirement count
    HAVING COUNT(*) = (SELECT COUNT(*) FROM unique_filters)
)
SELECT 
    u.schema_url, u.id, u.team_id, u.created_at, u.updated_at,
    -- Using a subquery for attributes is often faster for EAV 
    -- than a massive JOIN + GROUP BY
    (
      SELECT array_agg(ROW(a.key, a.value))
      FROM zitadel_nextgen.user_attributes a
      WHERE a.project_id = u.project_id 
        AND a.user_id = u.id
        AND ($4 IS NULL OR a.key = ANY($4))
    ) AS attributes
FROM matching_ids m
-- We JOIN m to u. Because u.id is indexed (PK).
JOIN zitadel_nextgen.users u 
    ON u.project_id = $1 
    AND u.id = m.user_id;

EXECUTE list_users(
    'inst_1'
    , null
    , ARRAY[
        ROW('address.country'::TEXT, '"Japan"'::JSONB)::RECORD
        , ROW('address.country'::TEXT, '"Japan"'::JSONB)::RECORD
        , ROW('email_verified'::TEXT, 'true'::JSONB)::RECORD
    ]
    , '{email, username}'::TEXT[]
);
