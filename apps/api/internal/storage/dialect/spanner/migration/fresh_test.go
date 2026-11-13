//go:build spanner_integration

package migration

import (
	"io/fs"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// What [Fresh] reads from the migrations, which needs no database. That the
// statements give a database the state goose gives it is
// TestMigrationsRoundTrip's to prove, on an instance.
func TestFreshReadsEveryMigration(t *testing.T) {
	t.Parallel()

	empty, err := FreshAt(0)
	require.NoError(t, err)
	assert.Empty(t, empty.Schema)
	assert.Empty(t, empty.rows)
	assert.Empty(t, empty.versions)

	latest, err := FreshLatest()
	require.NoError(t, err)
	files, err := fs.Glob(sqlFiles, "sql/*.sql")
	require.NoError(t, err)
	require.Len(t, latest.versions, len(files), "one version for each migration file")
	assert.IsIncreasing(t, latest.versions)

	for _, statement := range latest.Schema {
		assert.True(t, isDDLStatement(strings.Split(statement, "\n")), statement)
	}
	require.NotEmpty(t, latest.rows, "the authz catalog's rows come from the migrations")
	for _, statement := range append(latest.Schema, latest.rows...) {
		assert.NotEmpty(t, statement)
		assert.False(t, strings.HasSuffix(statement, ";"), statement)
		assert.NotContains(t, statement, "+goose", statement)
	}
	for _, statement := range latest.rows {
		assert.True(t, strings.HasPrefix(strings.ToUpper(statement), "INSERT"), statement)
		assert.NotContains(t, strings.ToUpper(statement), "SELECT", statement)
	}

	// A version in the middle is the start of the newest one.
	middle := latest.versions[len(latest.versions)/2]
	half, err := FreshAt(middle)
	require.NoError(t, err)
	require.NotEmpty(t, half.Schema)
	assert.Equal(t, latest.Schema[:len(half.Schema)], half.Schema)
	assert.Equal(t, latest.rows[:len(half.rows)], half.rows)
	assert.Equal(t, middle, half.versions[len(half.versions)-1])
}

func TestInsertsRows(t *testing.T) {
	t.Parallel()
	for statement, want := range map[string]bool{
		"INSERT INTO t (a) VALUES (1)":            true,
		"-- seeds\nINSERT INTO t (a)\nVALUES (1)": true,
		"INSERT INTO t (a) SELECT a FROM u":       false,
		"UPDATE t SET a = 1 WHERE TRUE":           false,
		"DELETE FROM t WHERE TRUE":                false,
		"CREATE TABLE t (a INT64) PRIMARY KEY(a)": false,
	} {
		assert.Equal(t, want, insertsRows(strings.Split(statement, "\n")), statement)
	}
}
