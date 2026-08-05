//go:build spanner_integration

package spanner

import (
	"context"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// SeedProjectsTiedAt inserts projects that share created_at/updated_at.
// CreateProject cannot do this (it always stamps "now"), so cursor-tie tests need DML.
func SeedProjectsTiedAt(ctx context.Context, pool database.Pool, ids []string, createdAt time.Time) error {
	c, ok := pool.(*Client)
	if !ok {
		return fmt.Errorf("spanner.SeedProjectsTiedAt: expected *Client, got %T", pool)
	}
	db := newClientDB(c.client)
	for _, id := range ids {
		_, err := db.Update(ctx, buildStatement(
			`INSERT INTO projects (id, name, preview_origins, created_at, updated_at) VALUES (@p1, @p2, @p3, @p4, @p4)`,
			id, "project-"+id, "[]", createdAt,
		).statement())
		if err != nil {
			return err
		}
	}
	return nil
}
