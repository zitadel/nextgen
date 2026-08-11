//go:build sqlite_integration

package platform

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/dbtest"
)

// TestEnsureSQLiteIdempotent proves the DB-backed idempotency the issue
// requires: running Ensure twice against the same database leaves exactly one
// "Platform" project row and the second run succeeds without error.
func TestEnsureSQLiteIdempotent(t *testing.T) {
	ctx := t.Context()

	dbPool, stop, err := dbtest.SQLite(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)

	projectID := domain.PlatformProjectID
	pool := service.NewPool(dbPool)

	// First run creates the row.
	require.NoError(t, Ensure(ctx, pool, true))

	created, err := pool.Statements().GetProjectByID(ctx, projectID)
	require.NoError(t, err)
	require.Equal(t, projectID, created.ID)
	require.Equal(t, "Platform", created.Name)

	// Second run is a no-op success; the row is unchanged.
	require.NoError(t, Ensure(ctx, pool, true))

	after, err := pool.Statements().GetProjectByID(ctx, projectID)
	require.NoError(t, err)
	require.Equal(t, projectID, after.ID)
	require.Equal(t, "Platform", after.Name)
	require.Equal(t, created.CreatedAt, after.CreatedAt)
}
