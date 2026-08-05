//go:build sqlite_integration

package sqlite

import (
	"context"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// SeedProjectsTiedAt inserts projects that share created_at/updated_at.
// CreateProject cannot do this (it always stamps "now"), so cursor-tie tests need DML.
func SeedProjectsTiedAt(ctx context.Context, pool database.Pool, ids []string, createdAt time.Time) error {
	p, ok := pool.(*Pool)
	if !ok {
		return fmt.Errorf("sqlite.SeedProjectsTiedAt: expected *Pool, got %T", pool)
	}
	nanos := createdAt.UnixNano()
	for _, id := range ids {
		_, err := p.sqlDB.ExecContext(ctx,
			`INSERT INTO projects (id, name, preview_origins, created_at, updated_at) VALUES (?, ?, '[]', ?, ?)`,
			id, "project-"+id, nanos, nanos,
		)
		if err != nil {
			return err
		}
	}
	return nil
}
