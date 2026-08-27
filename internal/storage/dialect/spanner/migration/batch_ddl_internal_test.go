//go:build spanner_integration

package migration

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/storage/testdb"
)

// Migrate must actually batch. The context has to survive the trip through
// goose's provider into its Exec calls, and if it does not, batching silently
// turns off: every suite still passes, because the emulator applies DDL
// instantly either way, and the whole point of #973 is lost with no signal.
// So assert on the counters rather than on the schema.
func TestMigrateBatchesDDLPerFile(t *testing.T) {
	dsn, stop, err := testdb.SpannerDSN(t.Context())
	require.NoError(t, err)
	t.Cleanup(stop)

	db, err := OpenDB(dsn)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	batchesBefore := ddlBatchesRun.Load()
	statementsBefore := ddlStatementsBuffed.Load()

	require.NoError(t, Migrate(t.Context(), db))

	batches := ddlBatchesRun.Load() - batchesBefore
	statements := ddlStatementsBuffed.Load() - statementsBefore

	require.Positive(t, batches, "migrations must run at least one DDL batch")
	require.Positive(t, statements, "migrations must buffer DDL statements")

	// The point of the change: many statements, far fewer round trips. Each
	// UpdateDatabaseDdl costs ~26s on a real instance, so the ratio is the
	// speedup. Anything at or below 1 means every statement went on its own.
	assert.Greater(t, statements, batches,
		"batching must group statements: got %d statements in %d batches", statements, batches)

	// Boundaries follow goose's one-connection-per-file checkout, so batches
	// should track the number of migration files, not the statement count.
	assert.Less(t, batches, statements/2,
		"expected file-sized batches, got %d batches for %d statements", batches, statements)

	t.Logf("migrated %d DDL statements in %d batches", statements, batches)
}
