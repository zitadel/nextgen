package sqlite

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
	"github.com/zitadel/nextgen/internal/instrumentation/metrics/metricstest"
)

// A pool reports its connections from the moment it is connected until it is
// closed. The readings are cumulative over every pool in the binary, so the
// test asserts what this pool adds; it is not parallel, so no other test
// opens or closes a pool while it runs.
func TestPool_reportsConnections(t *testing.T) {
	reader := metricstest.Install()
	ctx := t.Context()
	name := metrics.DBConnectionPoolKey.String(string(metrics.PoolSQLite))
	used := metrics.DBConnectionStateKey.String(string(metrics.PoolUsed))
	idle := metrics.DBConnectionStateKey.String(string(metrics.PoolIdle))
	maxBefore := reader.CounterSum(t, metrics.DBConnectionMax, name)
	usedBefore := reader.CounterSum(t, metrics.DBConnectionCount, name, used)
	idleBefore := reader.CounterSum(t, metrics.DBConnectionCount, name, idle)

	pool, err := Config{Path: ":memory:"}.Connect(ctx)
	require.NoError(t, err)
	t.Cleanup(func() { _ = pool.Close(context.Background()) })

	// Connect opens the single connection SQLite gets and leaves it idle.
	assert.Equal(t, maxBefore+1, reader.CounterSum(t, metrics.DBConnectionMax, name))
	assert.Equal(t, idleBefore+1, reader.CounterSum(t, metrics.DBConnectionCount, name, idle))

	conn, err := pool.(*Pool).sqlDB.Conn(ctx)
	require.NoError(t, err)
	assert.Equal(t, usedBefore+1, reader.CounterSum(t, metrics.DBConnectionCount, name, used),
		"a connection handed out is in use")
	require.NoError(t, conn.Close())

	require.NoError(t, pool.Close(ctx))
	assert.Equal(t, maxBefore, reader.CounterSum(t, metrics.DBConnectionMax, name),
		"a closed pool reports nothing")
}
