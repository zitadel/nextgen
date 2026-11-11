//go:build postgres_integration

package migration

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The teams, flow definitions, user schemas and connections that exist when
// 000043 runs get their search entries from the migration: each name and its
// later words, at the newest revision.
func TestSearchEntriesBackfill(t *testing.T) {
	ctx := t.Context()
	db := roundTripDB(t)

	require.NoError(t, createSchema(ctx, db, migrationSessionLocker{}))
	p, err := newProvider(db)
	require.NoError(t, err)
	_, err = p.UpTo(ctx, 42)
	require.NoError(t, err)

	exec := func(query string, args ...any) {
		t.Helper()
		_, err := db.ExecContext(ctx, query, args...)
		require.NoError(t, err)
	}
	exec(`INSERT INTO zitadel_nextgen.projects (id, name) VALUES ('p', 'p')`)
	exec(`INSERT INTO zitadel_nextgen.teams (project_id, id, name) VALUES ('p', 't1', 'Payments Alpha')`)
	exec(`INSERT INTO zitadel_nextgen.flow_definitions (project_id, id, name, schema_version, purposes, definition, created_at)
		VALUES ('p', 'f_old', 'partner-sign-in', '1.0.0', ARRAY['login']::zitadel_nextgen.flow_definition_purposes[], '{}', '2026-01-01'),
		       ('p', 'f_new', 'partner-sign-in', '1.0.0', ARRAY['register', 'login']::zitadel_nextgen.flow_definition_purposes[], '{}', '2026-01-02')`)
	exec(`INSERT INTO zitadel_nextgen.json_schemas (project_id, url, object_type, kind, created_at, payload)
		VALUES ('p', 's_old', 'partner-user', 'user-schema', '2026-01-01', '{"title":"Old Staff"}'),
		       ('p', 's_new', 'partner-user', 'user-schema', '2026-01-02', '{"title":"Partner Staff"}'),
		       ('p', 's_ref', NULL, 'unknown', '2026-01-02', '{"title":"Referenced"}')`)
	exec(`INSERT INTO zitadel_nextgen.idp_connections (project_id, id, slug) VALUES ('p', 'c1', 'partner-sso')`)
	exec(`INSERT INTO zitadel_nextgen.idp_connection_revisions (project_id, id, connection_id, document, created_at)
		VALUES ('p', 'r1', 'c1', '{"display_name":"Old"}', '2026-01-01'),
		       ('p', 'r2', 'c1', '{"display_name":"Partner Portal"}', '2026-01-02')`)

	_, err = p.UpTo(ctx, 43)
	require.NoError(t, err)

	rows, err := db.QueryContext(ctx, `SELECT resource_kind || '|' || resource_id || '|' || search_text || '|' || name_start::text || '|' || title || '|' || subtitle
		FROM zitadel_nextgen.search_entries WHERE project_id = 'p'`)
	require.NoError(t, err)
	defer rows.Close()
	var got []string
	for rows.Next() {
		var entry string
		require.NoError(t, rows.Scan(&entry))
		got = append(got, entry)
	}
	require.NoError(t, rows.Err())
	assert.ElementsMatch(t, []string{
		"team|t1|payments alpha|true|Payments Alpha|",
		"team|t1|alpha|false|Payments Alpha|",
		"flow_definition|f_new|partner-sign-in|true|partner-sign-in|login, register",
		"flow_definition|f_new|sign-in|false|partner-sign-in|login, register",
		"flow_definition|f_new|in|false|partner-sign-in|login, register",
		"schema|s_new|partner staff|true|Partner Staff|partner-user",
		"schema|s_new|staff|false|Partner Staff|partner-user",
		"schema|s_new|partner-user|true|Partner Staff|partner-user",
		"schema|s_new|user|false|Partner Staff|partner-user",
		"idp_connection|c1|partner-sso|true|Partner Portal|partner-sso",
		"idp_connection|c1|sso|false|Partner Portal|partner-sso",
		"idp_connection|c1|partner portal|true|Partner Portal|partner-sso",
		"idp_connection|c1|portal|false|Partner Portal|partner-sso",
	}, got)
}
