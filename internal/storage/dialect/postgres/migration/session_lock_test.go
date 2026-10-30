//go:build postgres_integration

package migration

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestMigrationLockAllowsConcurrentIndex(t *testing.T) {
	db := roundTripDB(t)
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()

	holder, err := db.Conn(ctx)
	require.NoError(t, err)
	defer holder.Close()
	waiter, err := db.Conn(ctx)
	require.NoError(t, err)
	defer waiter.Close()

	_, err = holder.ExecContext(ctx, "CREATE TABLE migration_lock_probe (id integer)")
	require.NoError(t, err)
	locker := migrationSessionLocker{}
	require.NoError(t, locker.SessionLock(ctx, holder))
	defer func() {
		_, _ = holder.ExecContext(context.Background(), "SELECT pg_advisory_unlock_all()")
	}()

	var waiterPID int
	require.NoError(t, waiter.QueryRowContext(ctx, "SELECT pg_backend_pid()").Scan(&waiterPID))
	done := make(chan error, 1)
	go func() {
		err := locker.SessionLock(ctx, waiter)
		if err == nil {
			err = locker.SessionUnlock(ctx, waiter)
		}
		done <- err
	}()

	// Start the index only after the other connection has attempted to lock.
	// A blocking pg_advisory_lock keeps that statement's transaction open:
	// CREATE INDEX CONCURRENTLY then waits for it, closing a deadlock cycle.
	require.Eventually(t, func() bool {
		var attempted bool
		err := db.QueryRowContext(ctx,
			"SELECT query LIKE '%advisory_lock%' FROM pg_stat_activity WHERE pid = $1",
			waiterPID,
		).Scan(&attempted)
		return err == nil && attempted
	}, 5*time.Second, 10*time.Millisecond)
	select {
	case err := <-done:
		t.Fatalf("waiter returned before the migration lock was released: %v", err)
	default:
	}

	_, err = holder.ExecContext(ctx, "CREATE INDEX CONCURRENTLY migration_lock_probe_idx ON migration_lock_probe (id)")
	require.NoError(t, err)
	require.NoError(t, locker.SessionUnlock(ctx, holder))
	select {
	case err := <-done:
		require.NoError(t, err)
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
}
