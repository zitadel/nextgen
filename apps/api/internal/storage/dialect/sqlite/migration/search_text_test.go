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

// The users that exist when 000027 runs get their search text from the
// migration: only the attributes their own schema designates, only strings,
// and never an empty one.
func TestSearchTextBackfill(t *testing.T) {
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
	_, err = p.UpTo(ctx, 26)
	require.NoError(t, err)

	exec := func(query string, args ...any) {
		t.Helper()
		_, err := db.ExecContext(ctx, query, args...)
		require.NoError(t, err)
	}
	exec(`INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p', 'p', 1, 1)`)
	for url, payload := range map[string]string{
		"designated": `{"x-identifier":"email","x-display":["name.given","name.family"]}`,
		"identifier": `{"x-identifier":"username"}`,
		"plain":      `{"type":"object"}`,
	} {
		exec(`INSERT INTO json_schemas (project_id, url, kind, created_at, payload) VALUES ('p', ?, 'user-schema', 1, ?)`, url, payload)
	}
	for user, schema := range map[string]string{"u_designated": "designated", "u_identifier": "identifier", "u_plain": "plain"} {
		exec(`INSERT INTO users (project_id, id, schema_url, created_at, updated_at) VALUES ('p', ?, ?, 1, 1)`, user, schema)
	}
	for _, attr := range []struct{ user, key, value string }{
		{"u_designated", "email", `"Ann@Example.com"`},
		{"u_designated", "name.given", `"Ann"`},
		{"u_designated", "name.family", `""`},
		{"u_designated", "nickname", `"Annie"`},
		{"u_identifier", "username", `"BEN"`},
		{"u_identifier", "email", `"ben@example.com"`},
		{"u_plain", "email", `"cleo@example.com"`},
		{"u_plain", "username", `42`},
	} {
		exec(`INSERT INTO user_attributes (project_id, user_id, key, value) VALUES ('p', ?, ?, ?)`, attr.user, attr.key, attr.value)
	}

	_, err = p.UpTo(ctx, 27)
	require.NoError(t, err)

	rows, err := db.QueryContext(ctx, `SELECT user_id || '/' || key, search_text FROM user_attributes WHERE search_text IS NOT NULL ORDER BY 1`)
	require.NoError(t, err)
	defer rows.Close()
	got := map[string]string{}
	for rows.Next() {
		var attr, text string
		require.NoError(t, rows.Scan(&attr, &text))
		got[attr] = text
	}
	require.NoError(t, rows.Err())
	assert.Equal(t, map[string]string{
		"u_designated/email":      "ann@example.com",
		"u_designated/name.given": "ann",
		"u_identifier/username":   "ben",
	}, got)
}
