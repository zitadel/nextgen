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
