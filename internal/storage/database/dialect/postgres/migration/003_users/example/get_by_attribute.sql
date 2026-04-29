DEALLOCATE ALL;

PREPARE get_user_by_unique_attribute (
    TEXT,    -- $1 project_id
    TEXT,    -- $2 team_id (Pass NULL for global, or the ID for org-scoped)
    TEXT,    -- $3 key
    JSONB,   -- $4 value
    TEXT[]   -- $5 attributes to fetch
) AS
WITH target AS (
    SELECT user_id
    FROM zitadel_nextgen.user_unique_attributes
    WHERE project_id = $1
    AND team_id = COALESCE($2, '')
    AND key = $3
    AND value_hash = digest($4::text, 'md5')
    LIMIT 2 -- Surface unique constraint bugs. 
)
SELECT 
    u.schema_url, u.id, u.team_id, u.created_at, u.updated_at,
    (
      SELECT array_agg(ROW(a.key, a.value))
      FROM zitadel_nextgen.user_attributes a
      WHERE a.project_id = u.project_id 
        AND a.user_id = u.id
        AND ($5 IS NULL OR a.key = ANY($5))
    ) AS attributes
FROM target t
JOIN zitadel_nextgen.users u 
    ON u.project_id = $1 
    AND u.id = t.user_id;

-- Globally Unique Attribute (email) without team context
EXECUTE get_user_by_unique_attribute(
    'inst_10', 
    null, 
    'email', 
    '"U_000017@nextgen.zitadel.com"', 
    ARRAY['username', 'email', 'email_verified']
);

-- Team Unique Attribute (nickname) with team context
EXECUTE get_user_by_unique_attribute(
    'inst_10', 
    'org_0001', 
    'nickname', 
    '"N_0017"', 
    ARRAY['username', 'email', 'email_verified']
);
