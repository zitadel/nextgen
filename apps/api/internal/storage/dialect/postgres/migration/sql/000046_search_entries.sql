-- +goose Up
-- What search finds a team, a user schema, a flow definition and an identity
-- provider connection by (ADR 087 §5): one row per text of its entry, a name
-- case-folded by the server (domain.SearchEntry), or the name's tail from one
-- of its later words. The statements that write those resources write their
-- entry in the same transaction. The key comes first after the kind because a
-- search is one range of it, read in key order: a page costs the same in a
-- project with three teams and in one with a million.
--
-- resource_key is what a newer revision replaces an entry by (a schema's object
-- type, a flow's name, else the id); resource_id is the id search answers with,
-- the newest revision's. title and subtitle are what search shows, so a search
-- reads nothing but this range.
CREATE TABLE zitadel_nextgen.search_entries (
    project_id      TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , resource_kind TEXT COLLATE "C" NOT NULL CHECK (resource_kind <> '')
    , search_text   TEXT COLLATE "C" NOT NULL CHECK (search_text <> '')
    , resource_key  TEXT COLLATE "C" NOT NULL CHECK (resource_key <> '')
    , resource_id   TEXT COLLATE "C" NOT NULL CHECK (resource_id <> '')
    , name_start    BOOLEAN NOT NULL
    , title         TEXT NOT NULL
    , subtitle      TEXT NOT NULL DEFAULT ''

    , PRIMARY KEY (project_id, resource_kind, search_text, resource_key)
);

-- A write replaces an entry by its key.
CREATE INDEX idx_search_entries_key
    ON zitadel_nextgen.search_entries (project_id, resource_kind, resource_key);

-- The entries of what exists. lower() stands in for the server's case folding,
-- which SQL does not have, and [[:alnum:]] for its letters and digits: a name
-- they disagree on is found as the server writes it once it is next written.
-- One statement, like the backfill in 000042: acceptable while the server runs
-- only in preview with few rows.
INSERT INTO zitadel_nextgen.search_entries
    (project_id, resource_kind, search_text, resource_key, resource_id, name_start, title, subtitle)
SELECT n.project_id, n.kind, substr(n.folded, p.i), n.key, n.resource_id, bool_or(p.i = 1), n.title, n.subtitle
FROM (
    SELECT names.*, left(lower(names.name), 256) AS folded
    FROM (
        SELECT t.project_id, 'team' AS kind, t.id AS key, t.id AS resource_id,
            t.name AS title, '' AS subtitle, t.name AS name
        FROM zitadel_nextgen.teams t

        UNION ALL
        SELECT f.project_id, 'flow_definition', f.name, f.id, f.name,
            array_to_string(ARRAY(SELECT p::text FROM unnest(f.purposes) p ORDER BY 1), ', '),
            f.name
        FROM zitadel_nextgen.flow_definitions f
        WHERE NOT EXISTS (
            SELECT 1 FROM zitadel_nextgen.flow_definitions newer
            WHERE newer.project_id = f.project_id
              AND newer.name = f.name
              AND newer.created_at > f.created_at
        )

        UNION ALL
        SELECT s.project_id, 'schema', coalesce(s.object_type, s.url), s.url,
            coalesce(nullif(s.payload ->> 'title', ''), s.object_type, s.url),
            CASE WHEN coalesce(s.payload ->> 'title', '') <> ''
                      AND s.object_type IS DISTINCT FROM s.payload ->> 'title'
                 THEN coalesce(s.object_type, '') ELSE '' END,
            n.name
        FROM zitadel_nextgen.json_schemas s
        CROSS JOIN LATERAL (VALUES (s.payload ->> 'title'), (s.object_type)) AS n(name)
        WHERE s.kind = 'user-schema'
          AND NOT EXISTS (
              SELECT 1 FROM zitadel_nextgen.json_schemas newer
              WHERE newer.project_id = s.project_id
                AND newer.object_type = s.object_type
                AND newer.created_at > s.created_at
          )

        UNION ALL
        SELECT c.project_id, 'idp_connection', c.id, c.id,
            coalesce(nullif(r.document ->> 'display_name', ''), c.slug),
            CASE WHEN coalesce(r.document ->> 'display_name', '') NOT IN ('', c.slug)
                 THEN c.slug ELSE '' END,
            n.name
        FROM zitadel_nextgen.idp_connections c
        JOIN zitadel_nextgen.idp_connection_revisions r
            ON r.project_id = c.project_id AND r.connection_id = c.id
        CROSS JOIN LATERAL (VALUES (c.slug), (r.document ->> 'display_name')) AS n(name)
        WHERE NOT EXISTS (
            SELECT 1 FROM zitadel_nextgen.idp_connection_revisions newer
            WHERE newer.project_id = r.project_id
              AND newer.connection_id = r.connection_id
              AND newer.created_at > r.created_at
        )
    ) names
    WHERE coalesce(names.name, '') <> ''
) n
CROSS JOIN LATERAL generate_series(1, length(n.folded)) AS p(i)
WHERE p.i = 1
   OR (substr(n.folded, p.i, 1) ~ '[[:alnum:]]' AND substr(n.folded, p.i - 1, 1) !~ '[[:alnum:]]')
GROUP BY n.project_id, n.kind, substr(n.folded, p.i), n.key, n.resource_id, n.title, n.subtitle;

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.search_entries;
