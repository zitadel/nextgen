//go:build postgres_integration

package postgres

import (
	"context"
	"crypto/rand"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/service"
	pgschema "github.com/zitadel/nextgen/internal/storage/dialect/postgres/schema"
)

// TestPoolRunsInConfiguredSchema migrates and writes through a pool whose
// DSN names a schema, on the pool path and on the transaction path, and
// checks that everything lands there and nothing in the default schema.
func TestPoolRunsInConfiguredSchema(t *testing.T) {
	ctx := t.Context()
	schema := "s_" + strings.ToLower(rand.Text())
	t.Cleanup(func() {
		_, err := testPool.pool.Exec(context.Background(), "DROP SCHEMA IF EXISTS "+schema+" CASCADE")
		assert.NoError(t, err)
	})

	dialect, err := DecodeConfig(withQueryParam(testDSN, searchPathParam+"="+schema))
	require.NoError(t, err)
	connected, err := dialect.Connect(ctx)
	require.NoError(t, err)
	t.Cleanup(func() { _ = connected.Close(context.Background()) })
	pool, ok := connected.(*Pool)
	require.True(t, ok)
	require.Equal(t, schema, pool.Schema())
	require.NoError(t, pool.Migrate(ctx))

	direct := newTestProject(uniqueProjectID(t))
	require.NoError(t, pool.CreateProject(ctx, direct))
	inTx := newTestProject(uniqueProjectID(t))
	require.NoError(t, pool.Transaction(ctx, func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
		return tx.Statements().CreateProject(ctx, inTx)
	}))

	got, err := pool.GetProjectByID(ctx, inTx.ID)
	require.NoError(t, err)
	assert.Equal(t, inTx.ID, got.ID)

	for _, id := range []string{direct.ID, inTx.ID} {
		assert.True(t, projectExistsIn(t, schema, id), "project %s in %s", id, schema)
		assert.False(t, projectExistsIn(t, pgschema.Default, id), "project %s must not leak into %s", id, pgschema.Default)
	}

	var tracked int
	require.NoError(t, testPool.pool.QueryRow(ctx,
		"SELECT count(*) FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('projects', 'goose_db_version')",
		schema,
	).Scan(&tracked))
	assert.Equal(t, 2, tracked, "the tables and the goose tracking table live in the schema")
}

func projectExistsIn(t *testing.T, schema, id string) bool {
	t.Helper()
	var exists bool
	require.NoError(t, testPool.pool.QueryRow(t.Context(),
		"SELECT EXISTS (SELECT 1 FROM "+schema+".projects WHERE id = $1)", id,
	).Scan(&exists))
	return exists
}

func withQueryParam(dsn, param string) string {
	if strings.Contains(dsn, "?") {
		return dsn + "&" + param
	}
	return dsn + "?" + param
}
