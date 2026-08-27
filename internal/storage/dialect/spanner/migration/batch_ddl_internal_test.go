//go:build spanner_integration

package migration

import (
	"io/fs"
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

	// Pin the file boundary, not just "fewer batches than statements". Batches
	// are delimited by goose's per-file version write, so there is at least one
	// per migration file carrying DDL. A ratio check alone would be satisfied by
	// the whole pending set travelling as a single batch, which is materially
	// worse to recover from (Spanner DDL batches are not atomic, so a failure
	// would leave schema applied across many files with no version recorded).
	files, err := fs.Glob(sqlFiles, "sql/*.sql")
	require.NoError(t, err)
	require.NotEmpty(t, files)
	assert.GreaterOrEqual(t, int(batches), len(files),
		"expected at least one batch per migration file: %d batches for %d files (%d statements). "+
			"Far fewer means the per-file flush point was lost and the pending set is batching as one",
		batches, len(files), statements)

	t.Logf("migrated %d DDL statements in %d batches across %d files", statements, batches, len(files))
}
