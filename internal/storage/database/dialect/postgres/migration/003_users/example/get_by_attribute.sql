DEALLOCATE ALL;

PREPARE get_user_by_unique_attribute (
    TEXT,    -- $1 instance_id
    TEXT,    -- $2 organization_id
    TEXT,    -- $3 key
    JSONB,   -- $4 value
    BOOLEAN, -- $5 use_global_index
    TEXT[]   -- $6 attributes to fetch
) AS
WITH target AS (
    SELECT user_id
    FROM zitadel_nextgen.user_attributes
    WHERE instance_id = $1
      AND key = $3
      AND value = $4
      -- 1. Satisfy the Partial Index condition
      AND jsonb_typeof(value) IN ('string', 'number', 'boolean')
      -- 2. Use a CASE or specific logic to isolate the branches
      AND (
          ($5 AND global_unique) 
          OR 
          (NOT $5 AND org_unique AND organization_id = $2)
      )
    LIMIT 2
)
SELECT 
    u.schema_url, u.id, u.organization_id, u.created_at, u.updated_at,
    (
      SELECT array_agg(ROW(a.key, a.value))
      FROM zitadel_nextgen.user_attributes a
      WHERE a.instance_id = u.instance_id 
        AND a.user_id = u.id
        AND ($6 IS NULL OR a.key = ANY($6))
    ) AS attributes
FROM target t
JOIN zitadel_nextgen.users u 
    ON u.instance_id = $1 
    AND u.id = t.user_id;

-- Globally Unique Attribute (email) without organization context
EXECUTE get_user_by_unique_attribute(
    'inst_10', 
    null, 
    'email', 
    '"U_000017@nextgen.zitadel.com"', 
    TRUE, 
    ARRAY['username', 'email', 'email_verified']
);

-- Globally Unique Attribute (email) with organization context (should yield same result as above)
EXECUTE get_user_by_unique_attribute(
    'inst_10', 
    'org_0001', 
    'email', 
    '"U_000017@nextgen.zitadel.com"', 
    TRUE, 
    ARRAY['username', 'email', 'email_verified']
);

-- Organization Unique Attribute (nickname) with organization context
EXECUTE get_user_by_unique_attribute(
    'inst_10', 
    'org_0001', 
    'nickname', 
    '"N_0017"', 
    FALSE, 
    ARRAY['username', 'email', 'email_verified']
);