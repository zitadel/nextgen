-- +goose Up
-- What search finds a team, a user schema, a flow definition and an identity
-- provider connection by. See the postgres peer (000045_search_entries.sql)
-- for the table. SQLite compares TEXT byte by byte, which is the code point
-- order the search ranges rely on.

-- +goose StatementBegin
CREATE TABLE search_entries (
    project_id    TEXT    NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    resource_kind TEXT    NOT NULL CHECK (resource_kind <> ''),
    search_text   TEXT    NOT NULL CHECK (search_text <> ''),
    resource_key  TEXT    NOT NULL CHECK (resource_key <> ''),
    resource_id   TEXT    NOT NULL CHECK (resource_id <> ''),
    name_start    INTEGER NOT NULL,
    title         TEXT    NOT NULL,
    subtitle      TEXT    NOT NULL DEFAULT '',
    PRIMARY KEY (project_id, resource_kind, search_text, resource_key)
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_search_entries_key
    ON search_entries (project_id, resource_kind, resource_key);
-- +goose StatementEnd

-- +goose StatementBegin
-- The entries of what exists. SQLite's lower() folds ASCII only, and a
-- character outside ASCII counts as a letter here: a name the server would
-- fold or split differently is found as the server writes it once it is next
-- written.
WITH RECURSIVE positions(i) AS (
    SELECT 1
    UNION ALL
    SELECT i + 1 FROM positions WHERE i < 256
),
schema_heads AS (
    SELECT s.project_id, coalesce(s.object_type, s.url) AS key, s.url,
        coalesce(nullif(json_extract(s.payload, '$.title'), ''), s.object_type, s.url) AS title,
        CASE WHEN coalesce(json_extract(s.payload, '$.title'), '') <> ''
                  AND s.object_type IS NOT json_extract(s.payload, '$.title')
             THEN coalesce(s.object_type, '') ELSE '' END AS subtitle,
        json_extract(s.payload, '$.title') AS title_name,
        s.object_type AS type_name
    FROM json_schemas s
    WHERE s.kind = 'user-schema'
      AND NOT EXISTS (
          SELECT 1 FROM json_schemas newer
          WHERE newer.project_id = s.project_id
            AND newer.object_type = s.object_type
            AND newer.created_at > s.created_at
      )
),
idp_heads AS (
    SELECT c.project_id, c.id,
        coalesce(nullif(json_extract(r.document, '$.display_name'), ''), c.slug) AS title,
        CASE WHEN coalesce(json_extract(r.document, '$.display_name'), '') NOT IN ('', c.slug)
             THEN c.slug ELSE '' END AS subtitle,
        c.slug,
        json_extract(r.document, '$.display_name') AS display_name
    FROM idp_connections c
    JOIN idp_connection_revisions r
        ON r.project_id = c.project_id AND r.connection_id = c.id
    WHERE NOT EXISTS (
        SELECT 1 FROM idp_connection_revisions newer
        WHERE newer.project_id = r.project_id
          AND newer.connection_id = r.connection_id
          AND newer.created_at > r.created_at
    )
),
names(project_id, kind, key, resource_id, title, subtitle, name) AS (
    SELECT t.project_id, 'team', t.id, t.id, t.name, '', t.name
    FROM teams t

    UNION ALL
    SELECT f.project_id, 'flow_definition', f.name, f.id, f.name,
        coalesce((SELECT group_concat(p.value, ', ') FROM (SELECT value FROM json_each(f.purposes) ORDER BY value) p), ''),
        f.name
    FROM flow_definitions f
    WHERE NOT EXISTS (
        SELECT 1 FROM flow_definitions newer
        WHERE newer.project_id = f.project_id
          AND newer.name = f.name
          AND newer.created_at > f.created_at
    )

    UNION ALL
    SELECT project_id, 'schema', key, url, title, subtitle, title_name FROM schema_heads
    UNION ALL
    SELECT project_id, 'schema', key, url, title, subtitle, type_name FROM schema_heads

    UNION ALL
    SELECT project_id, 'idp_connection', id, id, title, subtitle, slug FROM idp_heads
    UNION ALL
    SELECT project_id, 'idp_connection', id, id, title, subtitle, display_name FROM idp_heads
),
folded AS (
    SELECT names.*, substr(lower(names.name), 1, 256) AS text
    FROM names
    WHERE coalesce(names.name, '') <> ''
)
INSERT OR IGNORE INTO search_entries
    (project_id, resource_kind, search_text, resource_key, resource_id, name_start, title, subtitle)
SELECT f.project_id, f.kind, substr(f.text, p.i), f.key, f.resource_id, max(p.i = 1), f.title, f.subtitle
FROM folded f
JOIN positions p ON p.i <= length(f.text)
WHERE p.i = 1
   OR ((substr(f.text, p.i, 1) GLOB '[0-9a-z]' OR unicode(substr(f.text, p.i, 1)) > 127)
       AND NOT (substr(f.text, p.i - 1, 1) GLOB '[0-9a-z]' OR unicode(substr(f.text, p.i - 1, 1)) > 127))
GROUP BY f.project_id, f.kind, substr(f.text, p.i), f.key, f.resource_id, f.title, f.subtitle;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS search_entries;
-- +goose StatementEnd
