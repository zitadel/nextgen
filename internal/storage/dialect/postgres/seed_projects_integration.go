//go:build postgres_integration

package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
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

// HardDeleteTeam deletes a team row so stmttest can assert ON DELETE CASCADE
// behavior. There is no product DeleteTeam statement (only soft deactivate).
func HardDeleteTeam(ctx context.Context, pool database.Pool, projectID, teamID string) error {
	p, ok := pool.(*Pool)
	if !ok {
		return fmt.Errorf("postgres.HardDeleteTeam: expected *Pool, got %T", pool)
	}
	_, err := p.pool.Exec(ctx,
		`DELETE FROM zitadel_nextgen.teams WHERE project_id = $1 AND id = $2`,
		projectID, teamID,
	)
	return err
}

// InsertJSONSchemaAt inserts a json_schemas row at an exact created_at.
// CreateJSONSchema takes the timestamp from the database, so a test that needs
// two revisions to collide has to write the row itself.
func InsertJSONSchemaAt(ctx context.Context, pool database.Pool, projectID, url string, objectType *string, createdAt time.Time) error {
	p, ok := pool.(*Pool)
	if !ok {
		return fmt.Errorf("postgres.InsertJSONSchemaAt: expected *Pool, got %T", pool)
	}
	_, err := p.pool.Exec(ctx,
		`INSERT INTO zitadel_nextgen.json_schemas (project_id, url, object_type, kind, created_at, payload) VALUES ($1, $2, $3, $4, $5, '{}')`,
		projectID, url, objectType, domain.JSONSchemaKindUnknown.String(), createdAt,
	)
	return wrapError(err)
}
