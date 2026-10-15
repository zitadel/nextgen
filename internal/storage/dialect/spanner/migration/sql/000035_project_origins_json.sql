-- +goose NO TRANSACTION
-- +goose Up
-- Rename preview_origins → origins. Wire content becomes {pattern, kind}[];
-- UnmarshalOrigins still accepts legacy string[] on read.
-- +goose StatementBegin
ALTER TABLE projects ADD COLUMN origins STRING(MAX)
-- +goose StatementEnd
-- +goose StatementBegin
UPDATE projects SET origins = COALESCE(preview_origins, '[]') WHERE TRUE
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects ALTER COLUMN origins STRING(MAX) NOT NULL
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects DROP COLUMN preview_origins
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- Project each object's pattern (or a legacy string element) into a JSON
-- string array so a rollback after new writes still decodes as preview_origins.
-- +goose StatementBegin
ALTER TABLE projects ADD COLUMN preview_origins STRING(MAX)
-- +goose StatementEnd
-- +goose StatementBegin
UPDATE projects AS p
SET preview_origins = COALESCE(
    (
        SELECT TO_JSON_STRING(ARRAY_AGG(
            CASE
                WHEN JSON_TYPE(elem) = 'object' THEN JSON_VALUE(elem, '$.pattern')
                ELSE JSON_VALUE(elem, '$')
            END
            ORDER BY off
        ))
        FROM UNNEST(JSON_QUERY_ARRAY(PARSE_JSON(p.origins))) AS elem WITH OFFSET AS off
        WHERE CASE
            WHEN JSON_TYPE(elem) = 'object' THEN JSON_VALUE(elem, '$.pattern')
            ELSE JSON_VALUE(elem, '$')
        END IS NOT NULL
    ),
    '[]'
) WHERE TRUE
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects ALTER COLUMN preview_origins STRING(MAX) NOT NULL
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects DROP COLUMN origins
-- +goose StatementEnd
