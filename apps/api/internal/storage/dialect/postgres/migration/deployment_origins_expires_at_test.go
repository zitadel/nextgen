//go:build postgres_integration

package migration

import (
	"database/sql"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The newest preview deployment of each URL takes the expiry its previews row
// holds when 000052 runs; every other deployment keeps none.
func TestDeploymentOriginsExpiresAtBackfill(t *testing.T) {
	ctx := t.Context()
	db := roundTripDB(t)

	require.NoError(t, createSchema(ctx, db, migrationSessionLocker{}))
	p, err := newProvider(db)
	require.NoError(t, err)
	_, err = p.UpTo(ctx, 51)
	require.NoError(t, err)

	exec := func(query string, args ...any) {
		t.Helper()
		_, err := db.ExecContext(ctx, query, args...)
		require.NoError(t, err)
	}
	exec(`INSERT INTO zitadel_nextgen.projects (id, name) VALUES ('p', 'p')`)
	exec(`INSERT INTO zitadel_nextgen.releases (project_id, id, content_hash, pointers, metadata)
		VALUES ('p', 'rel', repeat('a', 64), '[{"kind":"schema","handle":"h","revision_id":"r"}]'::jsonb, '{}'::jsonb)`)
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
		exec(`INSERT INTO zitadel_nextgen.deployments (project_id, id, release_id, origin_kind, metadata, deployed_at)
			VALUES ('p', $1, 'rel', $2, '{}'::jsonb, now())`, row.deployment, row.kind)
		exec(`INSERT INTO zitadel_nextgen.deployment_origins (project_id, deployment_id, origin, release_id, origin_kind, deployed_at, seq)
			VALUES ('p', $1, $2, 'rel', $3, now(), $4)`, row.deployment, row.origin, row.kind, row.seq)
	}
	aExpires := time.Date(2026, 10, 9, 14, 10, 0, 0, time.UTC)
	dExpires := time.Date(2026, 10, 10, 14, 10, 0, 0, time.UTC)
	exec(`INSERT INTO zitadel_nextgen.previews (project_id, origin, expires_at, created_at) VALUES ('p', 'https://a.vercel.app', $1, now())`, aExpires)
	exec(`INSERT INTO zitadel_nextgen.previews (project_id, origin, expires_at, created_at) VALUES ('p', 'https://d.vercel.app', $1, now())`, dExpires)

	_, err = p.UpTo(ctx, 52)
	require.NoError(t, err)

	rows, err := db.QueryContext(ctx, `SELECT deployment_id, expires_at FROM zitadel_nextgen.deployment_origins`)
	require.NoError(t, err)
	defer rows.Close()
	got := map[string]*time.Time{}
	for rows.Next() {
		var deployment string
		var expires sql.NullTime
		require.NoError(t, rows.Scan(&deployment, &expires))
		got[deployment] = nil
		if expires.Valid {
			got[deployment] = &expires.Time
		}
	}
	require.NoError(t, rows.Err())
	require.Len(t, got, 6)
	for _, deployment := range []string{"dep_superseded", "dep_removed", "dep_primary", "dep_primary_after_preview"} {
		assert.Nil(t, got[deployment], deployment)
	}
	require.NotNil(t, got["dep_newest"])
	assert.True(t, aExpires.Equal(*got["dep_newest"]))
	require.NotNil(t, got["dep_preview_then_primary"])
	assert.True(t, dExpires.Equal(*got["dep_preview_then_primary"]))
}
