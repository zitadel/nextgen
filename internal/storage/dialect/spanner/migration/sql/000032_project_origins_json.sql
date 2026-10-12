-- Rename preview_origins → origins. Wire content becomes {pattern, kind}[];
-- UnmarshalOrigins still accepts legacy string[] on read.
ALTER TABLE projects ADD COLUMN origins STRING(MAX);

UPDATE projects SET origins = COALESCE(preview_origins, '[]') WHERE TRUE;

ALTER TABLE projects ALTER COLUMN origins STRING(MAX) NOT NULL;

ALTER TABLE projects DROP COLUMN preview_origins;
