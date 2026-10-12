-- Replace preview_origins TEXT[] with origins JSONB of {pattern, kind}[].
ALTER TABLE zitadel_nextgen.projects
    ADD COLUMN origins JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE zitadel_nextgen.projects
SET origins = COALESCE(
    (
        SELECT jsonb_agg(
            jsonb_build_object('pattern', origin, 'kind', 'preview')
            ORDER BY ordinality
        )
        FROM unnest(preview_origins) WITH ORDINALITY AS t(origin, ordinality)
    ),
    '[]'::jsonb
);

ALTER TABLE zitadel_nextgen.projects
    DROP COLUMN preview_origins;
