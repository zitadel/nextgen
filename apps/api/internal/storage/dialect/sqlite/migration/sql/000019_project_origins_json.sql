-- +goose Up
-- Replace preview_origins JSON string[] with origins JSON of {pattern, kind}[].
-- Column add/drop keeps the parent table (and ON DELETE CASCADE children) intact.
-- +goose StatementBegin
ALTER TABLE projects ADD COLUMN origins TEXT NOT NULL DEFAULT '[]';
-- +goose StatementEnd
-- +goose StatementBegin
UPDATE projects
SET origins = CASE
    WHEN preview_origins IS NULL OR preview_origins = '' OR preview_origins = '[]' THEN '[]'
    ELSE COALESCE(
        (
            SELECT json_group_array(json_object('pattern', j.value, 'kind', 'preview'))
            FROM json_each(preview_origins) AS j
        ),
        '[]'
    )
END;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects DROP COLUMN preview_origins;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE projects ADD COLUMN preview_origins TEXT NOT NULL DEFAULT '[]';
-- +goose StatementEnd
-- +goose StatementBegin
UPDATE projects
SET preview_origins = CASE
    WHEN origins IS NULL OR origins = '' OR origins = '[]' THEN '[]'
    ELSE COALESCE(
        (
            SELECT json_group_array(
                CASE
                    WHEN j.type = 'object' THEN json_extract(j.value, '$.pattern')
                    ELSE j.value
                END
            )
            FROM json_each(origins) AS j
        ),
        '[]'
    )
END;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects DROP COLUMN origins;
-- +goose StatementEnd
