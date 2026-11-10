-- +goose Up
-- Lets a user be found by the start of their identifier or display name from
-- an index. See the postgres peer (000040_user_attributes_search_text.sql) for
-- the column and the index. SQLite compares TEXT byte by byte, which is the
-- code point order the search ranges rely on.

-- +goose StatementBegin
ALTER TABLE user_attributes ADD COLUMN search_text TEXT;
-- +goose StatementEnd

-- +goose StatementBegin
-- Fills the column for the users that exist. SQLite's lower() folds ASCII
-- only, so a value with other upper-case letters is found again once the user
-- is next written, which stores the exact text.
UPDATE user_attributes
SET search_text = substr(lower(json_extract(value, '$')), 1, 256)
WHERE search_text IS NULL
  AND json_type(value) = 'text'
  AND json_extract(value, '$') <> ''
  AND EXISTS (
      SELECT 1
      FROM users u
      JOIN json_schemas s ON s.project_id = u.project_id AND s.url = u.schema_url
      WHERE u.project_id = user_attributes.project_id
        AND u.id = user_attributes.user_id
        AND (
            user_attributes.key = json_extract(s.payload, '$."x-identifier"')
            OR (
                json_type(s.payload, '$."x-display"') = 'array'
                AND user_attributes.key IN (SELECT d.value FROM json_each(s.payload, '$."x-display"') d)
            )
        )
  );
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_user_attributes_search
    ON user_attributes (project_id, key, search_text, user_id)
    WHERE search_text IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_user_attributes_search;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE user_attributes DROP COLUMN search_text;
-- +goose StatementEnd
