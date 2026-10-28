//go:build postgres_integration

package postgres

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
	"github.com/zitadel/nextgen/internal/instrumentation/metrics/metricstest"
)

// A pool reports its connections from the moment it is connected until it is
// closed. The readings are cumulative over every pool in the binary (the
// shared testPool among them), so the test asserts what its own pool adds; it
// is not parallel, so no other test opens or closes a pool while it runs.
func TestPool_reportsConnections(t *testing.T) {
	reader := metricstest.Install()
	ctx := t.Context()
	name := metrics.DBConnectionPoolKey.String(string(metrics.PoolPostgres))
	used := metrics.DBConnectionStateKey.String(string(metrics.PoolUsed))
	idle := metrics.DBConnectionStateKey.String(string(metrics.PoolIdle))
	maxBefore := reader.CounterSum(t, metrics.DBConnectionMax, name)
	usedBefore := reader.CounterSum(t, metrics.DBConnectionCount, name, used)
	idleBefore := reader.CounterSum(t, metrics.DBConnectionCount, name, idle)

	config, err := pgxpool.ParseConfig(testPool.pool.Config().ConnString())
	require.NoError(t, err)
	config.MaxConns = 3
	pool, err := Config{Config: config}.Connect(ctx)
	require.NoError(t, err)
	t.Cleanup(func() { _ = pool.Close(context.Background()) })

	assert.Equal(t, maxBefore+3, reader.CounterSum(t, metrics.DBConnectionMax, name))

	conn, err := pool.(*Pool).pool.Acquire(ctx)
	require.NoError(t, err)
	assert.Equal(t, usedBefore+1, reader.CounterSum(t, metrics.DBConnectionCount, name, used),
		"an acquired connection is in use")
	conn.Release()
	assert.Equal(t, idleBefore+1, reader.CounterSum(t, metrics.DBConnectionCount, name, idle),
		"a released connection stays open and idle")

	require.NoError(t, pool.Close(ctx))
	assert.Equal(t, maxBefore, reader.CounterSum(t, metrics.DBConnectionMax, name),
		"a closed pool reports nothing")
}
