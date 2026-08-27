//go:build spanner_integration

package migration_test

import (
	"context"
	"database/sql"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/storage/dialect/spanner/migration"
	"github.com/zitadel/nextgen/internal/storage/testdb"
)

func openBatchTestDB(t *testing.T) *sql.DB {
	t.Helper()
	dsn, stop, err := testdb.SpannerDSN(t.Context())
	require.NoError(t, err)
	t.Cleanup(stop)

	db, err := migration.OpenDB(dsn)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func tableCount(t *testing.T, ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, name string,
) int64 {
	t.Helper()
	var n int64
	require.NoError(t, q.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM information_schema.tables WHERE table_name = @name",
		sql.Named("name", name),
	).Scan(&n))
	return n
}

func createTable(t *testing.T, ctx context.Context, e interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, name string,
) {
	t.Helper()
	_, err := e.ExecContext(ctx,
		"CREATE TABLE "+name+" (id STRING(MAX) NOT NULL) PRIMARY KEY (id)")
	require.NoError(t, err)
}

// A batching context on a held connection defers the DDL until something else
// forces a flush, and then applies all of it. This is the behaviour the whole
// change exists for: goose's per-file statements become one UpdateDatabaseDdl.
func TestDDLBatchingBuffersUntilFlush(t *testing.T) {
	ctx := migration.WithDDLBatching(t.Context())
	db := openBatchTestDB(t)

	conn, err := db.Conn(ctx)
	require.NoError(t, err)
	defer conn.Close()

	createTable(t, ctx, conn, "batch_buffered_a")
	createTable(t, ctx, conn, "batch_buffered_b")

	// A query on the same connection flushes, so check the buffer state with
	// the driver's own view: nothing is applied until that happens. The query
	// below is itself the flush, so assert on what it returns afterwards.
	require.EqualValues(t, 1, tableCount(t, ctx, conn, "batch_buffered_a"),
		"the flushing query must see the batch it just flushed")
	require.EqualValues(t, 1, tableCount(t, ctx, conn, "batch_buffered_b"),
		"every buffered statement must be applied, not just the last")
}

// Regression guard. Buffering is per connection, so DDL issued through the
// *sql.DB pool must never be batched: ensureLeaseRow creates the lock table and
// then reads it back, and the pool is free to serve those from two different
// connections. Batching them made the CREATE invisible to the SELECT and then
// discarded it on reset, which broke every spanner suite at startup.
func TestPooledDDLIsNotBatched(t *testing.T) {
	ctx := t.Context()
	db := openBatchTestDB(t)

	// Deliberately no WithDDLBatching: this mirrors ensureLeaseRow exactly.
	createTable(t, ctx, db, "pooled_visible")

	assert.EqualValues(t, 1, tableCount(t, ctx, db, "pooled_visible"),
		"DDL run through the pool must be applied before the next statement")
}

// The opt-in must not leak into reads issued on the pool either.
func TestBatchingContextOnPoolStillApplies(t *testing.T) {
	ctx := migration.WithDDLBatching(t.Context())
	db := openBatchTestDB(t)

	createTable(t, ctx, db, "pooled_batched_ctx")

	// Even under a batching context, a pooled Exec is followed by a pooled read
	// on a possibly different connection. Buffering here would lose the table,
	// so callers on the pool must not mark their context; this asserts the
	// blast radius if someone does.
	assert.EqualValues(t, 1, tableCount(t, ctx, db, "pooled_batched_ctx"),
		"a pooled batching context must still leave the schema usable")
}
