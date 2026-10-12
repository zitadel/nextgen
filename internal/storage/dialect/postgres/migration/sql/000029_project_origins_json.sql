-- +goose Up
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

-- +goose Down
ALTER TABLE zitadel_nextgen.projects
    ADD COLUMN preview_origins TEXT[] NOT NULL DEFAULT '{}';

UPDATE zitadel_nextgen.projects
SET preview_origins = COALESCE(
    (
        SELECT array_agg(elem->>'pattern' ORDER BY ordinality)
        FROM jsonb_array_elements(origins) WITH ORDINALITY AS t(elem, ordinality)
        WHERE elem ? 'pattern'
    ),
    '{}'::text[]
);

ALTER TABLE zitadel_nextgen.projects
    DROP COLUMN origins;
