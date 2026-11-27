-- +goose NO TRANSACTION
-- +goose Up
-- Lets a user be found by the start of their identifier or display name
-- without reading every attribute row of the project. search_text is the value
-- case-folded by the server (domain.SearchText), set only on the attributes a
-- user's schema designates with x-identifier or x-display; the index holds
-- those rows alone. Key before text: a search is one range per attribute key,
-- read in index order, so a page costs the same for one match and for a
-- million.
ALTER TABLE zitadel_nextgen.user_attributes
    ADD COLUMN IF NOT EXISTS search_text TEXT COLLATE "C";

-- Fills the column for the users that exist. lower() stands in for the
-- server's case folding, which SQL does not have: the two differ for a few
-- letters outside ASCII (ß, final sigma), and such a value is found again once
-- the user is next written, which stores the exact text. One statement, like
-- the copy in 000039: acceptable while the server runs only in preview with
-- few users. A rerun skips the rows already filled.
UPDATE zitadel_nextgen.user_attributes a
SET search_text = left(lower(a.value #>> '{}'), 256)
FROM zitadel_nextgen.users u
JOIN zitadel_nextgen.json_schemas s
    ON s.project_id = u.project_id AND s.url = u.schema_url
WHERE a.project_id = u.project_id
  AND a.user_id = u.id
  AND a.search_text IS NULL
  AND jsonb_typeof(a.value) = 'string'
  AND a.value #>> '{}' <> ''
  AND (
      a.key = s.payload ->> 'x-identifier'
      -- The CASE keeps json_array_elements_text off a payload without the
      -- list: SQL does not promise to test an AND's left side first.
      OR a.key IN (
          SELECT json_array_elements_text(
              CASE WHEN json_typeof(s.payload -> 'x-display') = 'array'
                   THEN s.payload -> 'x-display' ELSE '[]'::json END
          )
      )
  );

-- CONCURRENTLY, because user_attributes is on the request path and a plain
-- CREATE INDEX blocks its writes for the whole build: that is what NO
-- TRANSACTION above is for. A failed build leaves an INVALID index behind, so
-- the CREATE is preceded by a DROP and a rerun converges, as in 000019.
DROP INDEX IF EXISTS zitadel_nextgen.idx_user_attributes_search;
CREATE INDEX CONCURRENTLY idx_user_attributes_search
    ON zitadel_nextgen.user_attributes (project_id, key, search_text, user_id)
    WHERE search_text IS NOT NULL;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS zitadel_nextgen.idx_user_attributes_search;
ALTER TABLE zitadel_nextgen.user_attributes DROP COLUMN IF EXISTS search_text;
