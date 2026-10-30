//go:build postgres_integration

package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io"
	"net/url"
	"os"
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

	require.NoError(t, dropPreviewDatabases(ctx, baseDSN, time.Time{}, merged, "preview_never_created", idle), "a database already gone is no error")
	assert.False(t, exists(merged), "dropped")
	assert.False(t, exists(idle), "dropped through the same connection")
}

// An idle sweep lists stamps first and drops later. A deployment that stamps
// the database in between, while the sweep waits for its lock, keeps it; one
// that waits for the sweep's lock finds it gone and creates it again.
func TestIdleSweepKeepsADatabaseADeploymentStampsMeanwhile(t *testing.T) {
	ctx := context.Background()
	dsn, stop, err := testdb.PostgresDSN(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)

	suffix := make([]byte, 4)
	_, err = rand.Read(suffix)
	require.NoError(t, err)
	base := "launcher_race_base_" + hex.EncodeToString(suffix)
	name := "preview_race_test_" + hex.EncodeToString(suffix)
	identifier := pgx.Identifier{name}.Sanitize()

	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(func() {
		for _, db := range []string{name, base} {
			_, _ = conn.Exec(context.Background(), "DROP DATABASE IF EXISTS "+pgx.Identifier{db}.Sanitize()+" WITH (FORCE)")
		}
		_ = conn.Close(context.Background())
	})
	_, err = conn.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{base}.Sanitize())
	require.NoError(t, err)
	baseDSN, err := withDatabase(dsn, base)
	require.NoError(t, err)
	connect := func() *pgx.Conn {
		t.Helper()
		c, err := pgx.Connect(ctx, baseDSN)
		require.NoError(t, err)
		t.Cleanup(func() { _ = c.Close(context.Background()) })
		return c
	}
	exists := func() bool {
		t.Helper()
		var found bool
		require.NoError(t, conn.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)", name).Scan(&found))
		return found
	}
	stampAt := func(c *pgx.Conn, at time.Time) {
		t.Helper()
		_, err := c.Exec(ctx, "COMMENT ON DATABASE "+identifier+" IS "+
			quoteLiteral(fmt.Sprintf(`{"branch":"feature/back","deployed_at":%q}`, at.UTC().Format(time.RFC3339))))
		require.NoError(t, err)
	}
	waits := func(done <-chan error, what string) {
		t.Helper()
		select {
		case err := <-done:
			t.Fatalf("%s did not wait for the lock: %v", what, err)
		case <-time.After(500 * time.Millisecond):
		}
	}

	now := time.Now()
	idleBefore := now.Add(-30 * 24 * time.Hour)
	require.NoError(t, ensurePreviewDatabase(ctx, baseDSN, name, "feature/back", now.Add(-40*24*time.Hour)))
	listed, err := listPreviewDatabases(ctx, baseDSN)
	require.NoError(t, err)
	idle, _ := idlePreviewDatabases(listed, idleBefore)
	var picked []string
	for _, db := range idle {
		picked = append(picked, db.name)
	}
	require.Contains(t, picked, name, "the sweep's snapshot picks it")

	// A deployment of the branch stamps it, holding the lock as
	// ensurePreviewDatabase does, while the sweep comes to drop it.
	deployment := connect()
	unlock, err := lockPreviewDatabase(ctx, deployment, name)
	require.NoError(t, err)
	swept := make(chan error, 1)
	go func() { swept <- dropPreviewDatabases(ctx, baseDSN, idleBefore, name) }()
	waits(swept, "the sweep")
	stampAt(deployment, now)
	unlock()
	require.NoError(t, <-swept)
	assert.True(t, exists(), "the deployment keeps its database")

	// The other order: the sweep holds the lock and drops it while a
	// deployment comes to stamp it.
	stampAt(conn, now.Add(-40*24*time.Hour))
	sweep := connect()
	unlock, err = lockPreviewDatabase(ctx, sweep, name)
	require.NoError(t, err)
	deployed := make(chan error, 1)
	go func() { deployed <- ensurePreviewDatabase(ctx, baseDSN, name, "feature/back", now) }()
	waits(deployed, "the deployment")
	_, err = sweep.Exec(ctx, "DROP DATABASE "+identifier+" WITH (FORCE)")
	require.NoError(t, err)
	unlock()
	require.NoError(t, <-deployed)
	assert.True(t, exists(), "the deployment creates it again")
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

	err = dropPreviewDatabases(ctx, deploymentDSN, time.Time{}, name)
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

// A role that cannot act as the default role creates the database as itself.
// Only it can drop that one, so the build log warns.
func TestEnsurePreviewDatabaseWarnsWhenOnlyItsRoleCanDropIt(t *testing.T) {
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
	outsider := "launcher_outsider_" + hex.EncodeToString(suffix)
	name := "preview_outsider_test_" + hex.EncodeToString(suffix)
	if _, err := admin.Exec(ctx, "CREATE ROLE "+pgx.Identifier{outsider}.Sanitize()+" LOGIN CREATEDB PASSWORD 'outsider'"); err != nil {
		t.Skipf("cannot create roles on this test database: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = admin.Exec(bg, "DROP DATABASE IF EXISTS "+pgx.Identifier{name}.Sanitize()+" WITH (FORCE)")
		_, _ = admin.Exec(bg, "DROP ROLE IF EXISTS "+pgx.Identifier{outsider}.Sanitize())
	})
	u, err := url.Parse(dsn)
	if err != nil || u.Scheme == "" {
		t.Skip("the test database URL is not a postgres:// URL")
	}
	u.User = url.UserPassword(outsider, "outsider")

	logged := captureStderr(t, func() {
		require.NoError(t, ensurePreviewDatabase(ctx, u.String(), name, "feature/outsider", time.Now()))
	})
	var owner string
	require.NoError(t, admin.QueryRow(ctx, "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = $1", name).Scan(&owner))
	assert.Equal(t, outsider, owner, "created as the connecting role")
	assert.Contains(t, logged, "warning: created "+pgx.Identifier{name}.Sanitize()+" as "+outsider)
	assert.Contains(t, logged, "the preview cleanup cannot")
}

// captureStderr returns what run writes to os.Stderr.
func captureStderr(t *testing.T, run func()) string {
	t.Helper()
	r, w, err := os.Pipe()
	require.NoError(t, err)
	previous := os.Stderr
	os.Stderr = w
	defer func() { os.Stderr = previous }()
	run()
	require.NoError(t, w.Close())
	out, err := io.ReadAll(r)
	require.NoError(t, err)
	return string(out)
}

// On PlanetScale the preview builds' role has CREATEDB of its own. It still
// creates the database as the default role, so another role that inherits
// that one (the cleanup workflow's, an operator's) can drop it, and it
// migrates it through the same inheritance: extensions, database options,
// schema and tables.
func TestEnsurePreviewDatabaseLeavesItToTheDefaultRoleWithCreateDB(t *testing.T) {
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
	builds := "launcher_builds_" + hex.EncodeToString(suffix)
	cleanup := "launcher_cleanup_" + hex.EncodeToString(suffix)
	base := "launcher_owner_base_" + hex.EncodeToString(suffix)
	name := "preview_owner_test_" + hex.EncodeToString(suffix)
	t.Cleanup(func() {
		bg := context.Background()
		for _, db := range []string{name, base} {
			_, _ = admin.Exec(bg, "DROP DATABASE IF EXISTS "+pgx.Identifier{db}.Sanitize()+" WITH (FORCE)")
		}
		for _, role := range []string{builds, cleanup} {
			_, _ = admin.Exec(bg, "DROP ROLE IF EXISTS "+pgx.Identifier{role}.Sanitize())
		}
	})
	for _, role := range []string{builds, cleanup} {
		ident := pgx.Identifier{role}.Sanitize()
		if _, err := admin.Exec(ctx, "CREATE ROLE "+ident+" LOGIN CREATEDB PASSWORD 'member'"); err != nil {
			t.Skipf("cannot create roles on this test database: %v", err)
		}
		if _, err := admin.Exec(ctx, "GRANT "+pgx.Identifier{adminRole}.Sanitize()+" TO "+ident); err != nil {
			t.Skipf("cannot grant %s on this test database: %v", adminRole, err)
		}
	}
	// A base database of its own: a shared test server's postgres database
	// may hold the server's schema, which the drop refuses.
	_, err = admin.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{base}.Sanitize())
	require.NoError(t, err)
	as := func(role, database string) string {
		t.Helper()
		u, err := url.Parse(dsn)
		if err != nil || u.Scheme == "" {
			t.Skip("the test database URL is not a postgres:// URL")
		}
		u.User = url.UserPassword(role, "member")
		u.Path = "/" + database
		return u.String()
	}

	require.NoError(t, ensurePreviewDatabase(ctx, as(builds, base), name, "feature/owner", time.Now()))
	var owner string
	require.NoError(t, admin.QueryRow(ctx, "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = $1", name).Scan(&owner))
	assert.Equal(t, adminRole, owner, "created as the default role, although the builds' role may create databases itself")

	preview, err := sql.Open("pgx", as(builds, name))
	require.NoError(t, err)
	require.NoError(t, migration.Migrate(ctx, preview), "the builds' role migrates what the default role owns")
	require.NoError(t, preview.Close())

	require.NoError(t, dropPreviewDatabases(ctx, as(cleanup, base), time.Time{}, name), "another member drops it")
	var found bool
	require.NoError(t, admin.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)", name).Scan(&found))
	assert.False(t, found)
}
