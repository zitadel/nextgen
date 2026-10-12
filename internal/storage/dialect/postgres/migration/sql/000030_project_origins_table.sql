-- Move origins off the projects JSONB column into a natural-key child table.
CREATE TABLE zitadel_nextgen.project_origins (
    project_id TEXT COLLATE "C" NOT NULL
    , pattern TEXT COLLATE "C" NOT NULL CHECK (pattern <> '')
    , kind TEXT COLLATE "C" NOT NULL CHECK (kind IN ('primary', 'preview'))
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , PRIMARY KEY (project_id, pattern)
    , FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
);

INSERT INTO zitadel_nextgen.project_origins (project_id, pattern, kind)
SELECT
    p.id,
    COALESCE(elem->>'pattern', elem #>> '{}'),
    COALESCE(elem->>'kind', 'preview')
FROM zitadel_nextgen.projects p
CROSS JOIN LATERAL jsonb_array_elements(p.origins) AS elem
WHERE jsonb_typeof(p.origins) = 'array'
  AND jsonb_array_length(p.origins) > 0
  AND (
      (jsonb_typeof(elem) = 'object' AND elem ? 'pattern')
      OR jsonb_typeof(elem) = 'string'
  );

ALTER TABLE zitadel_nextgen.projects
    DROP COLUMN origins;
