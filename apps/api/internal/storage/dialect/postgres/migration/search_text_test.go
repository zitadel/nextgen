//go:build postgres_integration

package migration

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The users that exist when 000040 runs get their search text from the
// migration: only the attributes their own schema designates, only strings,
// and never an empty one.
func TestSearchTextBackfill(t *testing.T) {
	ctx := t.Context()
	db := roundTripDB(t)

	require.NoError(t, createSchema(ctx, db, migrationSessionLocker{}))
	p, err := newProvider(db)
	require.NoError(t, err)
	_, err = p.UpTo(ctx, 39)
	require.NoError(t, err)

	exec := func(query string, args ...any) {
		t.Helper()
		_, err := db.ExecContext(ctx, query, args...)
		require.NoError(t, err)
	}
	exec(`INSERT INTO zitadel_nextgen.projects (id, name) VALUES ('p', 'p')`)
	for url, payload := range map[string]string{
		"designated": `{"x-identifier":"email","x-display":["name.given","name.family"]}`,
		"identifier": `{"x-identifier":"username"}`,
		"plain":      `{"type":"object"}`,
	} {
		exec(`INSERT INTO zitadel_nextgen.json_schemas (project_id, url, kind, payload) VALUES ('p', $1, 'user-schema', $2::json)`, url, payload)
	}
	for user, schema := range map[string]string{"u_designated": "designated", "u_identifier": "identifier", "u_plain": "plain"} {
		exec(`INSERT INTO zitadel_nextgen.users (project_id, id, schema_url) VALUES ('p', $1, $2)`, user, schema)
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
		exec(`INSERT INTO zitadel_nextgen.user_attributes (project_id, user_id, key, value) VALUES ('p', $1, $2, $3::jsonb)`, attr.user, attr.key, attr.value)
	}

	_, err = p.UpTo(ctx, 40)
	require.NoError(t, err)

	rows, err := db.QueryContext(ctx, `SELECT user_id || '/' || key, search_text FROM zitadel_nextgen.user_attributes WHERE search_text IS NOT NULL`)
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
