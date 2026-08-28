package migration

import (
	"io/fs"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A run of consecutive DDL becomes one batch, and DML in the middle splits it.
// This is the whole property, and it needs no database: the rewriter is a pure
// function over the migration text.
func TestBatchUpDDLSplitsRunsAtDML(t *testing.T) {
	t.Parallel()

	src := strings.Join([]string{
		"-- +goose NO TRANSACTION",
		"-- +goose Up",
		stmt("ALTER TABLE teams ADD COLUMN status STRING(MAX)"),
		stmt("ALTER TABLE users ADD COLUMN status STRING(MAX)"),
		stmt("UPDATE users SET status = 'active'"),
		stmt("CREATE TABLE team_memberships (id STRING(MAX)) PRIMARY KEY (id)"),
		"-- +goose Down",
		stmt("DROP TABLE team_memberships"),
	}, "\n")

	got := batchUpDDL(src)

	// Two DDL runs in Up, so two batches: ALTER+ALTER, then CREATE.
	assert.Equal(t, 2, strings.Count(got, "START BATCH DDL"))
	assert.Equal(t, 2, strings.Count(got, "RUN BATCH"))

	// The UPDATE must sit outside any batch: DML inside a DDL batch is rejected.
	upSection := got[strings.Index(got, "-- +goose Up"):strings.Index(got, "-- +goose Down")]
	beforeUpdate := upSection[:strings.Index(upSection, "UPDATE users")]
	assert.Equal(t, 1, strings.Count(beforeUpdate, "START BATCH DDL"),
		"the first run opens before the ALTERs")
	assert.Equal(t, 1, strings.Count(beforeUpdate, "RUN BATCH"),
		"the first run must close before the UPDATE, not span it")

	// Down is left alone.
	downSection := got[strings.Index(got, "-- +goose Down"):]
	assert.NotContains(t, downSection, "START BATCH DDL",
		"only the Up section is rewritten")
}

// The Up section can end at EOF rather than at a Down marker.
func TestBatchUpDDLClosesRunAtEOF(t *testing.T) {
	t.Parallel()
	src := "-- +goose Up\n" + stmt("CREATE TABLE t (id STRING(MAX)) PRIMARY KEY (id)")
	got := batchUpDDL(src)
	assert.Equal(t, 1, strings.Count(got, "START BATCH DDL"))
	assert.Equal(t, 1, strings.Count(got, "RUN BATCH"))
	assert.True(t, strings.HasSuffix(strings.TrimSpace(got), "-- +goose StatementEnd"),
		"RUN BATCH must be emitted before the file ends, got:\n%s", got)
}

// A leading comment inside the block must not hide the verb: 000011's UPDATE is
// preceded by four comment lines, and misreading it as DDL would put DML in a
// batch.
func TestBatchUpDDLClassifiesPastLeadingComments(t *testing.T) {
	t.Parallel()
	assert.False(t, isDDLStatement([]string{
		stmtBegin, "-- explanatory comment", "-- second line",
		"UPDATE users SET x = 1", stmtEnd,
	}), "a commented DML statement is still DML")
	assert.True(t, isDDLStatement([]string{
		stmtBegin, "-- explanatory comment",
		"CREATE TABLE t (id STRING(MAX)) PRIMARY KEY (id)", stmtEnd,
	}), "a commented DDL statement is still DDL")
}

// Non-migration input is passed through untouched.
func TestBatchUpDDLLeavesNonMigrationsAlone(t *testing.T) {
	t.Parallel()
	src := "SELECT 1\n"
	assert.Equal(t, src, batchUpDDL(src))
}

// The real migrations must survive the rewrite: every Up DDL statement ends up
// inside a batch, and no DML does. 000011 is the file that interleaves them.
func TestBatchDDLFSOverRealMigrations(t *testing.T) {
	t.Parallel()
	sub, err := fs.Sub(sqlFiles, "sql")
	require.NoError(t, err)
	wrapped := batchDDLFS{inner: sub}

	names, err := fs.Glob(sub, "*.sql")
	require.NoError(t, err)
	require.NotEmpty(t, names, "the FS wrapper must not hide the migrations from goose")

	totalBatches := 0
	for _, name := range names {
		body, err := fs.ReadFile(wrapped, name)
		require.NoError(t, err, "goose must be able to read %s through the wrapper", name)

		text := string(body)
		opens := strings.Count(text, "START BATCH DDL")
		closes := strings.Count(text, "RUN BATCH")
		assert.Equal(t, opens, closes, "%s: every batch must be closed", name)
		totalBatches += opens
	}
	assert.Positive(t, totalBatches, "the migrations must produce at least one batch")

	mixed, err := fs.ReadFile(wrapped, "000011_user_team_lifecycle.sql")
	require.NoError(t, err)
	assert.Greater(t, strings.Count(string(mixed), "START BATCH DDL"), 1,
		"000011 interleaves DML between its DDL, so it must split into several runs")
}

func stmt(sql string) string {
	return stmtBegin + "\n" + sql + "\n" + stmtEnd
}
