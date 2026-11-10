-- +goose NO TRANSACTION
-- +goose Up
-- Lets a user be found by the start of their identifier or display name from
-- an index. See the postgres peer (000042_user_attributes_search_text.sql) for
-- the column and the index. Spanner orders STRING by code point, which is the
-- order the search ranges rely on.

-- +goose StatementBegin
ALTER TABLE user_attributes ADD COLUMN search_text STRING(MAX)
-- +goose StatementEnd
-- +goose StatementBegin
-- Fills the column for the users that exist. LOWER stands in for the server's
-- case folding: the two differ for a few letters outside ASCII, and such a
-- value is found again once the user is next written.
UPDATE user_attributes a
SET search_text = SUBSTR(LOWER(JSON_VALUE(a.value, '$')), 1, 256)
WHERE a.search_text IS NULL
  AND JSON_TYPE(a.value) = 'string'
  AND JSON_VALUE(a.value, '$') <> ''
  AND EXISTS (
      SELECT 1
      FROM users u
      JOIN json_schemas s ON s.project_id = u.project_id AND s.url = u.schema_url
      WHERE u.project_id = a.project_id
        AND u.id = a.user_id
        AND (
            a.key = JSON_VALUE(s.payload, '$."x-identifier"')
            OR a.key IN (
                SELECT JSON_VALUE(d, '$')
                FROM UNNEST(JSON_QUERY_ARRAY(s.payload, '$."x-display"')) AS d
            )
        )
  )
-- +goose StatementEnd
-- +goose StatementBegin
-- NULL_FILTERED leaves out the attributes no search reads.
CREATE NULL_FILTERED INDEX idx_user_attributes_search
    ON user_attributes (project_id, key, search_text, user_id)
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX idx_user_attributes_search
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_attributes DROP COLUMN search_text
-- +goose StatementEnd
