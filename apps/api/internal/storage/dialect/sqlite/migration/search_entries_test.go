package migration

import (
	"context"
	"database/sql"
	"net/url"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The teams, flow definitions, user schemas and connections that exist when
// 000032 runs get their search entries from the migration: each name and its
// later words, at the newest revision.
func TestSearchEntriesBackfill(t *testing.T) {
	ctx := context.Background()
	dsn := &url.URL{
		Scheme:   "file",
		Path:     filepath.ToSlash(filepath.Join(t.TempDir(), "backfill.db")),
		RawQuery: PragmaQuery,
	}
	db, err := sql.Open("sqlite", dsn.String())
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	db.SetMaxOpenConns(1)

	p, err := newProvider(db)
	require.NoError(t, err)
	_, err = p.UpTo(ctx, 31)
	require.NoError(t, err)

	exec := func(query string, args ...any) {
		t.Helper()
		_, err := db.ExecContext(ctx, query, args...)
		require.NoError(t, err)
	}
	exec(`INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p', 'p', 1, 1)`)
	exec(`INSERT INTO teams (project_id, id, name, created_at, updated_at) VALUES ('p', 't1', 'Payments Alpha', 1, 1)`)
	exec(`INSERT INTO flow_definitions (project_id, id, name, schema_version, purposes, definition, created_at, updated_at)
		VALUES ('p', 'f_old', 'partner-sign-in', '1.0.0', '["login"]', '{}', 1, 1),
		       ('p', 'f_new', 'partner-sign-in', '1.0.0', '["register","login"]', '{}', 2, 2)`)
	exec(`INSERT INTO json_schemas (project_id, url, object_type, kind, created_at, payload)
		VALUES ('p', 's_old', 'partner-user', 'user-schema', 1, '{"title":"Old Staff"}'),
		       ('p', 's_new', 'partner-user', 'user-schema', 2, '{"title":"Partner Staff"}'),
		       ('p', 's_ref', NULL, 'unknown', 2, '{"title":"Referenced"}')`)
	exec(`INSERT INTO idp_connections (project_id, id, slug, created_at) VALUES ('p', 'c1', 'partner-sso', 1)`)
	exec(`INSERT INTO idp_connection_revisions (project_id, id, connection_id, document, created_at)
		VALUES ('p', 'r1', 'c1', '{"display_name":"Old"}', 1),
		       ('p', 'r2', 'c1', '{"display_name":"Partner Portal"}', 2)`)

	_, err = p.UpTo(ctx, 32)
	require.NoError(t, err)

	rows, err := db.QueryContext(ctx, `SELECT resource_kind || '|' || resource_id || '|' || search_text || '|' || name_start || '|' || title || '|' || subtitle
		FROM search_entries WHERE project_id = 'p'`)
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
		"team|t1|payments alpha|1|Payments Alpha|",
		"team|t1|alpha|0|Payments Alpha|",
		"flow_definition|f_new|partner-sign-in|1|partner-sign-in|login, register",
		"flow_definition|f_new|sign-in|0|partner-sign-in|login, register",
		"flow_definition|f_new|in|0|partner-sign-in|login, register",
		"schema|s_new|partner staff|1|Partner Staff|partner-user",
		"schema|s_new|staff|0|Partner Staff|partner-user",
		"schema|s_new|partner-user|1|Partner Staff|partner-user",
		"schema|s_new|user|0|Partner Staff|partner-user",
		"idp_connection|c1|partner-sso|1|Partner Portal|partner-sso",
		"idp_connection|c1|sso|0|Partner Portal|partner-sso",
		"idp_connection|c1|partner portal|1|Partner Portal|partner-sso",
		"idp_connection|c1|portal|0|Partner Portal|partner-sso",
	}, got)
}
