-- +goose NO TRANSACTION
-- +goose Up
-- What search finds a team, a user schema, a flow definition and an identity
-- provider connection by. See the postgres peer (000043_search_entries.sql)
-- for the table. The search order is the primary key's, so a search reads the
-- table itself; Spanner orders STRING by code point, which is the order the
-- search ranges rely on.

-- +goose StatementBegin
CREATE TABLE search_entries (
    project_id    STRING(MAX) NOT NULL,
    resource_kind STRING(MAX) NOT NULL,
    search_text   STRING(MAX) NOT NULL,
    resource_key  STRING(MAX) NOT NULL,
    resource_id   STRING(MAX) NOT NULL,
    name_start    BOOL NOT NULL,
    title         STRING(MAX) NOT NULL,
    subtitle      STRING(MAX) NOT NULL DEFAULT (''),
    CONSTRAINT chk_search_entries_resource_kind CHECK (resource_kind <> ''),
    CONSTRAINT chk_search_entries_search_text CHECK (search_text <> ''),
    CONSTRAINT chk_search_entries_resource_key CHECK (resource_key <> ''),
    CONSTRAINT chk_search_entries_resource_id CHECK (resource_id <> ''),
    CONSTRAINT fk_search_entries_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
) PRIMARY KEY (project_id, resource_kind, search_text, resource_key)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_search_entries_key
    ON search_entries (project_id, resource_kind, resource_key)
-- +goose StatementEnd

-- +goose StatementBegin
-- The entries of what exists. LOWER stands in for the server's case folding
-- and \pL\pN for its letters and digits: a name they disagree on is found as
-- the server writes it once it is next written.
INSERT INTO search_entries
    (project_id, resource_kind, search_text, resource_key, resource_id, name_start, title, subtitle)
SELECT f.project_id, f.kind, SUBSTR(f.folded, i), f.key, f.resource_id, LOGICAL_OR(i = 1), f.title, f.subtitle
FROM (
    SELECT n.project_id, n.kind, n.key, n.resource_id, n.title, n.subtitle,
        SUBSTR(LOWER(n.name), 1, 256) AS folded
    FROM (
        SELECT t.project_id, 'team' AS kind, t.id AS key, t.id AS resource_id,
            t.name AS title, '' AS subtitle, t.name AS name
        FROM teams t

        UNION ALL
        SELECT fd.project_id, 'flow_definition', fd.name, fd.id, fd.name,
            ARRAY_TO_STRING(ARRAY(SELECT p FROM UNNEST(fd.purposes) AS p ORDER BY p), ', '),
            fd.name
        FROM flow_definitions fd
        WHERE NOT EXISTS (
            SELECT 1 FROM flow_definitions newer
            WHERE newer.project_id = fd.project_id
              AND newer.name = fd.name
              AND newer.created_at > fd.created_at
        )

        UNION ALL
        SELECT s.project_id, 'schema', COALESCE(s.object_type, s.url), s.url,
            COALESCE(NULLIF(JSON_VALUE(s.payload, '$.title'), ''), s.object_type, s.url),
            CASE WHEN COALESCE(JSON_VALUE(s.payload, '$.title'), '') <> ''
                      AND COALESCE(s.object_type, '') <> JSON_VALUE(s.payload, '$.title')
                 THEN COALESCE(s.object_type, '') ELSE '' END,
            name
        FROM json_schemas s
        CROSS JOIN UNNEST([JSON_VALUE(s.payload, '$.title'), s.object_type]) AS name
        WHERE s.kind = 'user-schema'
          AND NOT EXISTS (
              SELECT 1 FROM json_schemas newer
              WHERE newer.project_id = s.project_id
                AND newer.object_type = s.object_type
                AND newer.created_at > s.created_at
          )

        UNION ALL
        SELECT c.project_id, 'idp_connection', c.id, c.id,
            COALESCE(NULLIF(JSON_VALUE(r.document, '$.display_name'), ''), c.slug),
            CASE WHEN COALESCE(JSON_VALUE(r.document, '$.display_name'), '') NOT IN ('', c.slug)
                 THEN c.slug ELSE '' END,
            name
        FROM idp_connections c
        JOIN idp_connection_revisions r
            ON r.project_id = c.project_id AND r.connection_id = c.id
        CROSS JOIN UNNEST([c.slug, JSON_VALUE(r.document, '$.display_name')]) AS name
        WHERE NOT EXISTS (
            SELECT 1 FROM idp_connection_revisions newer
            WHERE newer.project_id = r.project_id
              AND newer.connection_id = r.connection_id
              AND newer.created_at > r.created_at
        )
    ) n
    WHERE COALESCE(n.name, '') <> ''
) f
CROSS JOIN UNNEST(GENERATE_ARRAY(1, CHAR_LENGTH(f.folded))) AS i
WHERE i = 1
   OR (REGEXP_CONTAINS(SUBSTR(f.folded, i, 1), r'[\pL\pN]')
       AND NOT REGEXP_CONTAINS(SUBSTR(f.folded, i - 1, 1), r'[\pL\pN]'))
GROUP BY f.project_id, f.kind, SUBSTR(f.folded, i), f.key, f.resource_id, f.title, f.subtitle
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX idx_search_entries_key
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE search_entries
-- +goose StatementEnd
