DEALLOCATE ALL;

PREPARE get_user_by_unique_attribute (
    TEXT,    -- $1 project_id
    TEXT,    -- $2 team_id (Pass NULL for global, or team id for team-scoped uniqueness)
    TEXT,    -- $3 key
    JSONB,   -- $4 value
    BYTEA,   -- $5 value_hash (SHA-256, from caller)
    TEXT[]   -- $6 attributes to fetch
) AS
WITH target AS (
    SELECT user_id
    FROM zitadel_nextgen.user_unique_attributes
    WHERE project_id = $1
    AND team_id = COALESCE($2, '')
    AND key = $3
    AND value_hash = $5
    LIMIT 2
)
SELECT
    u.schema_url, u.id, u.lifecycle_owner_team_id, u.status, u.created_at, u.updated_at,
    (
        SELECT array_agg(ROW(a.key, a.value))
        FROM zitadel_nextgen.user_attributes a
        WHERE a.project_id = u.project_id
        AND a.user_id = u.id
        AND ($6 IS NULL OR a.key = ANY($6))
    ) AS attributes
FROM target t
JOIN zitadel_nextgen.users u
    ON u.project_id = $1
    AND u.id = t.user_id;
