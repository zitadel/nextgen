package migration

import (
	"context"
	"database/sql"
	"net/url"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The newest preview deployment of each URL takes the expiry its previews row
// holds when 000039 runs; every other deployment keeps none.
func TestDeploymentOriginsExpiresAtBackfill(t *testing.T) {
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
	_, err = p.UpTo(ctx, 38)
	require.NoError(t, err)

	exec := func(query string, args ...any) {
		t.Helper()
		_, err := db.ExecContext(ctx, query, args...)
		require.NoError(t, err)
	}
	exec(`PRAGMA foreign_keys = OFF`)
	exec(`INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p', 'p', 1, 1)`)
	for _, row := range []struct {
		deployment, origin, kind string
		seq                      int
	}{
		{"dep_superseded", "https://a.vercel.app", "preview", 1},
		{"dep_newest", "https://a.vercel.app", "preview", 2},
		{"dep_removed", "https://b.vercel.app", "preview", 1},
		{"dep_primary", "https://app.acme.com", "primary", 1},
		{"dep_preview_then_primary", "https://d.vercel.app", "preview", 1},
		{"dep_primary_after_preview", "https://d.vercel.app", "primary", 2},
	} {
		exec(`INSERT INTO deployments (project_id, id, release_id, origin_kind, metadata, deployed_at) VALUES ('p', ?, 'rel', ?, '{}', 1)`, row.deployment, row.kind)
		exec(`INSERT INTO deployment_origins (project_id, deployment_id, origin, release_id, origin_kind, deployed_at, seq) VALUES ('p', ?, ?, 'rel', ?, 1, ?)`,
			row.deployment, row.origin, row.kind, row.seq)
	}
	exec(`INSERT INTO previews (project_id, origin, expires_at, created_at) VALUES ('p', 'https://a.vercel.app', 5000, 1)`)
	exec(`INSERT INTO previews (project_id, origin, expires_at, created_at) VALUES ('p', 'https://d.vercel.app', 7000, 1)`)

	_, err = p.UpTo(ctx, 39)
	require.NoError(t, err)

	rows, err := db.QueryContext(ctx, `SELECT deployment_id, expires_at FROM deployment_origins`)
	require.NoError(t, err)
	defer rows.Close()
	got := map[string]string{}
	for rows.Next() {
		var deployment string
		var expires sql.NullInt64
		require.NoError(t, rows.Scan(&deployment, &expires))
		got[deployment] = "NULL"
		if expires.Valid {
			got[deployment] = strconv.FormatInt(expires.Int64, 10)
		}
	}
	require.NoError(t, rows.Err())
	assert.Equal(t, map[string]string{
		"dep_superseded":            "NULL",
		"dep_newest":                "5000",
		"dep_removed":               "NULL",
		"dep_primary":               "NULL",
		"dep_preview_then_primary":  "7000",
		"dep_primary_after_preview": "NULL",
	}, got)
}
