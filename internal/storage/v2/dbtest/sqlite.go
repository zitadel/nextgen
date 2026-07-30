//go:build sqlite_integration

package dbtest

import (
	"context"
	"os"
	"path/filepath"

	v2sqlite "github.com/zitadel/nextgen/internal/storage/v2/dialect/sqlite"
)

// SQLite returns a connected v2 pool for the SQLite integration tests.
// The database file lives under a temp directory removed by the stop function.
func SQLite(ctx context.Context) (Pool, func(), error) {
	dir, err := os.MkdirTemp("", "zitadel-sqlite-dbtest-*")
	if err != nil {
		return nil, nil, err
	}
	stop := func() { _ = os.RemoveAll(dir) }

	dialect := v2sqlite.Config{Path: filepath.Join(dir, "test.db")}
	pool, err := dialect.Connect(ctx)
	if err != nil {
		stop()
		return nil, nil, err
	}
	if err := pool.Migrate(ctx); err != nil {
		_ = pool.Close(ctx)
		stop()
		return nil, nil, err
	}
	out, err := asPool(pool)
	if err != nil {
		_ = pool.Close(ctx)
		stop()
		return nil, nil, err
	}
	return out, stop, nil
}
