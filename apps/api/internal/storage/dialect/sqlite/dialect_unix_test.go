//go:build !windows

package sqlite

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Windows has no POSIX file modes and forbids "?" in a name, so these run elsewhere.

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

func TestConnectOpensAPathWithAQuestionMark(t *testing.T) {
	t.Parallel()

	dir := filepath.Join(t.TempDir(), "nested?mark")
	require.NoError(t, os.MkdirAll(dir, 0o700))
	dbPath := filepath.Join(dir, "zitadel.db")

	pool, err := Config{Path: dbPath}.Connect(context.Background())
	require.NoError(t, err)
	t.Cleanup(func() { _ = pool.Close(context.Background()) })

	info, err := os.Stat(dbPath)
	require.NoError(t, err)
	assert.True(t, info.Mode().IsRegular())
}
