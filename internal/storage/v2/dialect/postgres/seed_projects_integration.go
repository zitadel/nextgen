//go:build postgres_integration

package postgres

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
		return fmt.Errorf("postgres.SeedProjectsTiedAt: expected *Pool, got %T", pool)
	}
	for _, id := range ids {
		_, err := p.pool.Exec(ctx,
			`INSERT INTO zitadel_nextgen.projects (id, name, preview_origins, created_at, updated_at) VALUES ($1, $2, '{}'::text[], $3, $3)`,
			id, "project-"+id, createdAt,
		)
		if err != nil {
			return err
		}
	}
	return nil
}
