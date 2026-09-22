//go:build configfs_integration

package configfs_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/configfs"
)

// The dialect is what a deployment actually configures, so it has to decode
// from what a config file holds and connect to something usable.
func TestDialectDecodesAndConnects(t *testing.T) {
	root := t.TempDir()

	t.Run("a bare path is the project directory", func(t *testing.T) {
		// Exactly what the server does with the `database:` block it read.
		d, err := database.Config{Raw: map[string]any{configfs.DialectName: root}}.Build()
		require.NoError(t, err)
		assert.Equal(t, configfs.DialectName, d.Name())
	})

	t.Run("connects and migrates before setup has run", func(t *testing.T) {
		cfg, err := configfs.DecodeConfig(root)
		require.NoError(t, err)

		pool, err := cfg.Connect(t.Context())
		require.NoError(t, err, "a directory with no zitadel.json still opens")
		t.Cleanup(func() { _ = pool.Close(t.Context()) })

		require.NoError(t, pool.Migrate(t.Context()), "the SQL half still migrates")
		require.NoError(t, pool.Ping(t.Context()))

		// The database landed in the gitignored .zitadel/local, not beside the
		// configuration a developer commits.
		_, err = os.Stat(filepath.Join(root, ".zitadel", "local", "zitadel.db"))
		require.NoError(t, err)
		_, err = os.Stat(filepath.Join(root, ".zitadel", "zitadel.db"))
		assert.True(t, os.IsNotExist(err), "no database in the committed tree")
	})
}
