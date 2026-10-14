//go:build postgres_integration

package testdb

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Callers that share a server each get a database of their own: empty, out of
// the other callers' sight, and gone once their stop func ran, even with a
// connection still open. Without ZITADEL_TEST_POSTGRES_SERVER_URL a container
// stands in for the server.
func TestCreateDatabaseGivesEachCallerAnEmptyDatabaseOfItsOwn(t *testing.T) {
	ctx := t.Context()
	serverURL := os.Getenv(serverURLEnv)
	if serverURL == "" {
		dsn, stop, err := startPostgresContainerOnce(ctx)
		require.NoError(t, err)
		t.Cleanup(stop)
		serverURL = dsn
	}

	connect := func(dsn string) *pgx.Conn {
		t.Helper()
		conn, err := pgx.Connect(ctx, dsn)
		require.NoError(t, err)
		t.Cleanup(func() { _ = conn.Close(context.Background()) })
		return conn
	}
	tables := func(conn *pgx.Conn) int {
		t.Helper()
		var n int
		require.NoError(t, conn.QueryRow(ctx,
			"SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')").Scan(&n))
		return n
	}

	first, stopFirst, err := createPostgresDatabase(ctx, serverURL)
	require.NoError(t, err)
	second, stopSecond, err := createPostgresDatabase(ctx, serverURL)
	require.NoError(t, err)
	t.Cleanup(stopSecond)
	require.NotEqual(t, first, second)

	firstConn := connect(first)
	assert.Zero(t, tables(firstConn), "a new database is empty")
	_, err = firstConn.Exec(ctx, "CREATE TABLE marker (id int)")
	require.NoError(t, err)
	assert.Zero(t, tables(connect(second)), "the other caller's database does not see it")

	var name string
	require.NoError(t, firstConn.QueryRow(ctx, "SELECT current_database()").Scan(&name))
	stopFirst()
	var left int
	require.NoError(t, connect(serverURL).QueryRow(ctx,
		"SELECT count(*) FROM pg_catalog.pg_database WHERE datname = $1", name).Scan(&left))
	assert.Zero(t, left, "stop drops the database")
}
