//go:build spanner_integration

package migration

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/storage/testdb"
)

// databaseAt returns a provider over a database migrated to version, and the
// database. Where each test gets a database of its own it is created at
// version; on the emulator the migrations are walked up to it.
func databaseAt(t *testing.T, version int64) (*goose.Provider, *sql.DB) {
	t.Helper()
	ctx := t.Context()
	if testdb.SpannerSharesDatabase() {
		t.Skip("a test that migrates cannot share the database ZITADEL_TEST_SPANNER_URL names with other packages; set ZITADEL_TEST_SPANNER_INSTANCE or neither")
	}
	if testdb.SpannerProvisions() {
		fresh, err := FreshAt(version)
		require.NoError(t, err)
		dsn, stop, err := fresh.Provision(ctx)
		require.NoError(t, err)
		t.Cleanup(stop)
		p, db := openProvider(t, dsn)
		return p, db
	}
	dsn, stop, err := testdb.SpannerDSN(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)
	p, db := openProvider(t, dsn)
	_, err = p.UpTo(ctx, version)
	require.NoError(t, err)
	return p, db
}

// The newest preview deployment of each URL takes the expiry its previews row
// holds when 000056 runs; every other deployment keeps none.
func TestDeploymentOriginsExpiresAtBackfill(t *testing.T) {
	ctx := context.Background()
	p, db := databaseAt(t, 55)

	exec := func(query string) {
		t.Helper()
		_, err := db.ExecContext(ctx, query)
		require.NoError(t, err)
	}
	exec(`INSERT INTO projects (id, name) VALUES ('p', 'p')`)
	exec(`INSERT INTO releases (project_id, id, content_hash, pointers, metadata)
		VALUES ('p', 'rel', '` + strings.Repeat("a", 64) + `', JSON '[{"kind":"schema","handle":"h","revision_id":"r"}]', JSON '{}')`)
	for _, row := range []struct {
		deployment, origin, kind, seq string
	}{
		{"dep_superseded", "https://a.vercel.app", "preview", "1"},
		{"dep_newest", "https://a.vercel.app", "preview", "2"},
		{"dep_removed", "https://b.vercel.app", "preview", "1"},
		{"dep_primary", "https://app.acme.com", "primary", "1"},
		{"dep_preview_then_primary", "https://d.vercel.app", "preview", "1"},
		{"dep_primary_after_preview", "https://d.vercel.app", "primary", "2"},
	} {
		exec(`INSERT INTO deployments (project_id, id, release_id, origin_kind, metadata, deployed_at)
			VALUES ('p', '` + row.deployment + `', 'rel', '` + row.kind + `', JSON '{}', TIMESTAMP '2026-10-02T14:10:00Z')`)
		exec(`INSERT INTO deployment_origins (project_id, deployment_id, origin, release_id, origin_kind, deployed_at, seq)
			VALUES ('p', '` + row.deployment + `', '` + row.origin + `', 'rel', '` + row.kind + `', TIMESTAMP '2026-10-02T14:10:00Z', ` + row.seq + `)`)
	}
	aExpires := time.Date(2026, 10, 9, 14, 10, 0, 0, time.UTC)
	dExpires := time.Date(2026, 10, 10, 14, 10, 0, 0, time.UTC)
	exec(`INSERT INTO previews (project_id, origin, expires_at, created_at)
		VALUES ('p', 'https://a.vercel.app', TIMESTAMP '` + aExpires.Format(time.RFC3339) + `', TIMESTAMP '2026-10-02T14:10:00Z')`)
	exec(`INSERT INTO previews (project_id, origin, expires_at, created_at)
		VALUES ('p', 'https://d.vercel.app', TIMESTAMP '` + dExpires.Format(time.RFC3339) + `', TIMESTAMP '2026-10-02T14:10:00Z')`)

	_, err := p.UpTo(ctx, 56)
	require.NoError(t, err)

	rows, err := db.QueryContext(ctx, `SELECT deployment_id, expires_at FROM deployment_origins`)
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
