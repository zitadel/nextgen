//go:build postgres_integration

package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Both wire formats are read: the simple-protocol (text) read fails without the
// scan location on any host, while the binary read only fails off a UTC host.
func TestConfig_Connect_scansTimestamptzUTC(t *testing.T) {
	ctx := t.Context()
	config, err := pgxpool.ParseConfig(testPool.pool.Config().ConnString())
	require.NoError(t, err)
	config.ConnConfig.RuntimeParams["timezone"] = "America/New_York"
	pool, err := Config{Config: config}.Connect(ctx)
	require.NoError(t, err)
	t.Cleanup(func() { _ = pool.Close(context.Background()) })

	var binary, text time.Time
	require.NoError(t, pool.(*Pool).pool.QueryRow(ctx, "SELECT now()").Scan(&binary))
	require.NoError(t, pool.(*Pool).pool.QueryRow(ctx, "SELECT now()", pgx.QueryExecModeSimpleProtocol).Scan(&text))
	assert.Equal(t, time.UTC, binary.Location())
	assert.Equal(t, time.UTC, text.Location())
}
