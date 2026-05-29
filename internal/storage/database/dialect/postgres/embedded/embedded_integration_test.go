//go:build embedded_integration

package embedded_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres/embedded"
)

// TestStartEmbedded smoke-tests the embedded-postgres bring-up that backs the
// zero-config / single-binary server (run zitadel without standing up Postgres,
// sqlite-style). The container path (StartContainer) is covered by the
// postgres_integration suites; this guards the fergusstrange binary path
// (Maven download, initdb, the IPv4-only DSN + sslmode workaround, retry,
// cleanup) that no other test exercises after the testcontainer migration.
func TestStartEmbedded(t *testing.T) {
	ctx := context.Background()

	connector, stop, err := embedded.StartEmbedded()
	require.NoError(t, err)
	defer stop()

	pool, err := connector.Connect(ctx)
	require.NoError(t, err)
	defer pool.Close(ctx)

	// MigrateTest provisions the real schema against the embedded instance, and
	// Ping confirms the connection the zero-config server would use is live.
	require.NoError(t, pool.(database.PoolTest).MigrateTest(ctx))
	require.NoError(t, pool.Ping(ctx))
}
