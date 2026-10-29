//go:build postgres_integration

package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/storage/dialect/postgres/migration"
	"github.com/zitadel/nextgen/internal/storage/testdb"
)

func TestEnsurePreviewDatabaseCreatesStampsAndReuses(t *testing.T) {
	ctx := context.Background()
	dsn, stop, err := testdb.PostgresDSN(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)

	suffix := make([]byte, 4)
	_, err = rand.Read(suffix)
	require.NoError(t, err)
	name := "preview_launcher_test_" + hex.EncodeToString(suffix)

	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), "DROP DATABASE IF EXISTS "+pgx.Identifier{name}.Sanitize()+" WITH (FORCE)")
		_ = conn.Close(context.Background())
	})

	stamp := func() string {
		t.Helper()
		var comment string
		require.NoError(t, conn.QueryRow(ctx,
			"SELECT coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = $1", name).Scan(&comment))
		return comment
	}

	first := time.Date(2026, 10, 12, 15, 0, 0, 0, time.UTC)
	require.NoError(t, ensurePreviewDatabase(ctx, dsn, name, "feature/it's", first))
	assert.JSONEq(t, `{"branch":"feature/it's","deployed_at":"2026-10-12T15:00:00Z"}`, stamp(), "created and stamped")

	later := first.Add(time.Hour)
	require.NoError(t, ensurePreviewDatabase(ctx, dsn, name, "feature/it's", later), "an existing database is reused")
	assert.JSONEq(t, `{"branch":"feature/it's","deployed_at":"2026-10-12T16:00:00Z"}`, stamp(), "every deployment refreshes the stamp")
}

func TestDropPreviewDatabasesListsAndDropsWhatExists(t *testing.T) {
	ctx := context.Background()
	dsn, stop, err := testdb.PostgresDSN(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)

	suffix := make([]byte, 4)
	_, err = rand.Read(suffix)
	require.NoError(t, err)
	// A base database of its own: a shared test server's postgres database
	// may hold the server's schema, which the drop refuses.
	base := "launcher_base_test_" + hex.EncodeToString(suffix)
	merged := "preview_merged_test_" + hex.EncodeToString(suffix)
	idle := "preview_idle_test_" + hex.EncodeToString(suffix)

	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(func() {
		for _, db := range []string{merged, idle, base} {
			_, _ = conn.Exec(context.Background(), "DROP DATABASE IF EXISTS "+pgx.Identifier{db}.Sanitize()+" WITH (FORCE)")
		}
		_ = conn.Close(context.Background())
	})
	_, err = conn.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{base}.Sanitize())
	require.NoError(t, err)
	baseDSN, err := withDatabase(dsn, base)
	require.NoError(t, err)
	exists := func(name string) bool {
		t.Helper()
		var found bool
		require.NoError(t, conn.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)", name).Scan(&found))
		return found
	}

	deployed := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	require.NoError(t, ensurePreviewDatabase(ctx, baseDSN, merged, "feature/merged", deployed))
	require.NoError(t, ensurePreviewDatabase(ctx, baseDSN, idle, "feature/idle", deployed.Add(time.Hour)))

	listed, err := listPreviewDatabases(ctx, baseDSN)
	require.NoError(t, err)
	stamps := map[string]string{}
	for _, db := range listed {
		stamps[db.name] = db.stamp
	}
	assert.JSONEq(t, `{"branch":"feature/merged","deployed_at":"2026-09-01T12:00:00Z"}`, stamps[merged])
	assert.JSONEq(t, `{"branch":"feature/idle","deployed_at":"2026-09-01T13:00:00Z"}`, stamps[idle])
	assert.NotContains(t, stamps, base, "only preview databases")

	require.NoError(t, dropPreviewDatabases(ctx, baseDSN, merged, "preview_never_created", idle), "a database already gone is no error")
	assert.False(t, exists(merged), "dropped")
	assert.False(t, exists(idle), "dropped through the same connection")
}

// Production's database holds the server's schema; a drop through its URL,
// taken from Vercel's Production target by mistake, refuses to run.
func TestDropPreviewDatabaseRefusesADeploymentsDatabase(t *testing.T) {
	ctx := context.Background()
	dsn, stop, err := testdb.PostgresDSN(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)

	suffix := make([]byte, 4)
	_, err = rand.Read(suffix)
	require.NoError(t, err)
	deployment := "launcher_deployment_test_" + hex.EncodeToString(suffix)
	name := "preview_kept_test_" + hex.EncodeToString(suffix)

	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(func() {
		for _, db := range []string{name, deployment} {
			_, _ = conn.Exec(context.Background(), "DROP DATABASE IF EXISTS "+pgx.Identifier{db}.Sanitize()+" WITH (FORCE)")
		}
		_ = conn.Close(context.Background())
	})
	for _, db := range []string{deployment, name} {
		_, err = conn.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{db}.Sanitize())
		require.NoError(t, err)
	}
	deploymentDSN, err := withDatabase(dsn, deployment)
	require.NoError(t, err)
	schema, err := pgx.Connect(ctx, deploymentDSN)
	require.NoError(t, err)
	_, err = schema.Exec(ctx, "CREATE SCHEMA "+pgx.Identifier{migration.SchemaName}.Sanitize())
	require.NoError(t, err)
	require.NoError(t, schema.Close(ctx))

	err = dropPreviewDatabases(ctx, deploymentDSN, name)
	require.ErrorContains(t, err, "never Production's")
	_, err = listPreviewDatabases(ctx, deploymentDSN)
	require.ErrorContains(t, err, "never Production's", "an idle sweep refuses before it lists")
	var found bool
	require.NoError(t, conn.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)", name).Scan(&found))
	assert.True(t, found, "nothing dropped")
}

// A PlanetScale dashboard role that inherits the default role has no CREATEDB
// of its own; the launcher creates the database as the default role instead.
// Locally the stand-in for that role is the cluster's postgres role.
func TestEnsurePreviewDatabaseActsAsTheDefaultRoleWithoutCreateDB(t *testing.T) {
	ctx := context.Background()
	dsn, stop, err := testdb.PostgresDSN(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)

	admin, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(func() { _ = admin.Close(context.Background()) })

	suffix := make([]byte, 4)
	_, err = rand.Read(suffix)
	require.NoError(t, err)
	member := "launcher_member_" + hex.EncodeToString(suffix)
	name := "preview_member_test_" + hex.EncodeToString(suffix)
	memberIdent := pgx.Identifier{member}.Sanitize()

	if _, err := admin.Exec(ctx, "CREATE ROLE "+memberIdent+" LOGIN NOCREATEDB PASSWORD 'member'"); err != nil {
		t.Skipf("cannot create roles on this test database: %v", err)
	}
	if _, err := admin.Exec(ctx, "GRANT "+pgx.Identifier{adminRole}.Sanitize()+" TO "+memberIdent); err != nil {
		_, _ = admin.Exec(ctx, "DROP ROLE "+memberIdent)
		t.Skipf("cannot grant %s on this test database: %v", adminRole, err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = admin.Exec(bg, "DROP DATABASE IF EXISTS "+pgx.Identifier{name}.Sanitize()+" WITH (FORCE)")
		_, _ = admin.Exec(bg, "DROP ROLE IF EXISTS "+memberIdent)
	})

	u, err := url.Parse(dsn)
	if err != nil || u.Scheme == "" {
		t.Skip("the test database URL is not a postgres:// URL")
	}
	u.User = url.UserPassword(member, "member")

	require.NoError(t, ensurePreviewDatabase(ctx, u.String(), name, "feature/member", time.Now()))

	var owner string
	require.NoError(t, admin.QueryRow(ctx, "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = $1", name).Scan(&owner))
	assert.Equal(t, adminRole, owner, "created as the default role")
	var comment string
	require.NoError(t, admin.QueryRow(ctx,
		"SELECT coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = $1", name).Scan(&comment))
	assert.Contains(t, comment, "feature/member", "the member may stamp what its role owns")
}
