package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newMemoryDB opens a one-connection in-memory database with a single table t.
func newMemoryDB(t *testing.T) db {
	t.Helper()
	sqlDB, err := sql.Open("sqlite", ":memory:")
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	_, err = sqlDB.ExecContext(t.Context(), "CREATE TABLE t (x INTEGER)")
	require.NoError(t, err)
	return db{sqlDB: sqlDB}
}

func countRows(t *testing.T, d db) int {
	t.Helper()
	var n int
	require.NoError(t, d.sqlDB.QueryRowContext(t.Context(), "SELECT count(*) FROM t").Scan(&n))
	return n
}

func TestWithTransaction_tracedDBCommitsOnSuccess(t *testing.T) {
	t.Parallel()
	d := newMemoryDB(t)
	client := traced(d)
	require.Equal(t, client, traced(client), "traced must not wrap twice")
	err := withTransaction(t.Context(), client, func(ctx context.Context, tx queryExecutor) error {
		require.IsType(t, tracedExecutor{}, tx)
		assert.IsType(t, txExecutor{}, untraced(tx))
		_, err := tx.Exec(ctx, "INSERT INTO t (x) VALUES (1)")
		return err
	})
	require.NoError(t, err)
	assert.Equal(t, 1, countRows(t, d))
}

func TestWithTransaction_tracedDBRollsBackOnError(t *testing.T) {
	t.Parallel()
	d := newMemoryDB(t)
	want := errors.New("boom")
	err := withTransaction(t.Context(), traced(d), func(ctx context.Context, tx queryExecutor) error {
		_, err := tx.Exec(ctx, "INSERT INTO t (x) VALUES (1)")
		require.NoError(t, err)
		return want
	})
	require.ErrorIs(t, err, want)
	assert.Equal(t, 0, countRows(t, d))
}

func TestWithTransaction_tracedTxRunsDirectly(t *testing.T) {
	t.Parallel()
	d := newMemoryDB(t)
	sqlTx, err := d.sqlDB.BeginTx(t.Context(), nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlTx.Rollback() })
	outer := traced(txExecutor{sqlTx: sqlTx})

	err = withTransaction(t.Context(), outer, func(ctx context.Context, tx queryExecutor) error {
		assert.Equal(t, outer, tx)
		return nil
	})
	require.NoError(t, err)
}
