package sqlite

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMergeSQLitePragmas(t *testing.T) {
	t.Parallel()

	t.Run("empty query gets defaults", func(t *testing.T) {
		t.Parallel()
		got, err := mergeSQLitePragmas("file:test.db")
		require.NoError(t, err)
		require.True(t, strings.HasPrefix(got, "file:test.db?"))
		assert.Contains(t, got, "_txlock=immediate")
		assert.Contains(t, got, "foreign_keys")
		assert.Contains(t, got, "case_sensitive_like")
	})

	t.Run("existing query keeps caller values and fills missing", func(t *testing.T) {
		t.Parallel()
		got, err := mergeSQLitePragmas("file:test.db?mode=rw&_pragma=foreign_keys(0)")
		require.NoError(t, err)
		assert.Contains(t, got, "mode=rw")
		assert.Contains(t, got, "_pragma=foreign_keys(0)")
		assert.Contains(t, got, "_txlock=immediate")
		assert.Contains(t, got, "case_sensitive_like")
		// Caller already set foreign_keys; do not also add foreign_keys(1).
		assert.NotContains(t, got, "foreign_keys(1)")
	})
}

func TestConfigDSNMergesPragmas(t *testing.T) {
	t.Parallel()

	dsn, path, err := Config{DSN: "file:test.db"}.dsn()
	require.NoError(t, err)
	assert.Empty(t, path)
	assert.Contains(t, dsn, "_txlock=immediate")
	assert.Contains(t, dsn, "foreign_keys")
}

func TestConfigMemoryUsesUniqueName(t *testing.T) {
	t.Parallel()

	a, pathA, err := Config{Path: ":memory:"}.dsn()
	require.NoError(t, err)
	assert.Empty(t, pathA)
	b, pathB, err := Config{Path: ":memory:"}.dsn()
	require.NoError(t, err)
	assert.Empty(t, pathB)
	assert.NotEqual(t, a, b)
	assert.Contains(t, a, "mode=memory")
	assert.Contains(t, a, "cache=shared")
	assert.Contains(t, a, "_txlock=immediate")
}

func TestConnectTightensFilePermissions(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	dbPath := filepath.Join(dir, "zitadel.db")
	pool, err := Config{Path: dbPath}.Connect(context.Background())
	require.NoError(t, err)
	t.Cleanup(func() { _ = pool.Close(context.Background()) })

	info, err := os.Stat(dbPath)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())
}

func TestConfigPathURIEscapesMetacharacters(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name string
		dir  string
	}{
		{name: "question_mark", dir: "nested?mark"},
		{name: "hash", dir: "nested#hash"},
		{name: "percent", dir: "nested%25pct"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			root := t.TempDir()
			dir := filepath.Join(root, tc.dir)
			require.NoError(t, os.MkdirAll(dir, 0o700))
			dbPath := filepath.Join(dir, "zitadel.db")

			dsn, abs, err := Config{Path: dbPath}.dsn()
			require.NoError(t, err)
			assert.Equal(t, dbPath, abs)
			assert.NotContains(t, strings.SplitN(dsn, "?", 2)[0], "?mark")
			assert.Contains(t, dsn, "_txlock=immediate")

			pool, err := Config{Path: dbPath}.Connect(context.Background())
			require.NoError(t, err)
			t.Cleanup(func() { _ = pool.Close(context.Background()) })

			info, err := os.Stat(dbPath)
			require.NoError(t, err)
			assert.True(t, info.Mode().IsRegular())
		})
	}
}
