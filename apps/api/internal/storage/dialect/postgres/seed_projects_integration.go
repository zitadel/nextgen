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
			`INSERT INTO zitadel_nextgen.projects (id, name, created_at, updated_at) VALUES ($1, $2, $3, $3)`,
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

// DeleteProjectUsage deletes a project's usage rollups, which outlive the
// project by design: only its cursor cascades from projects.
func DeleteProjectUsage(ctx context.Context, pool database.Pool, projectID string) error {
	p, ok := pool.(*Pool)
	if !ok {
		return fmt.Errorf("postgres.DeleteProjectUsage: expected *Pool, got %T", pool)
	}
	for _, table := range []string{"usage_first_seen", "usage_hours", "usage_cursors"} {
		if _, err := p.pool.Exec(ctx, `DELETE FROM zitadel_nextgen.`+table+` WHERE project_id = $1`, projectID); err != nil {
			return err
		}
	}
	return nil
}

// InsertJSONSchemaAt inserts a json_schemas row at an exact created_at.
// CreateJSONSchema never accepts a caller-supplied created_at, so a test that
// needs two revisions to collide has to write the row itself.
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

// InsertFlowDefinitionAt inserts a flow_definitions row at an exact created_at.
// CreateFlowDefinition never accepts a caller-supplied created_at, so a test
// that needs two revisions to collide has to write the row itself.
func InsertFlowDefinitionAt(ctx context.Context, pool database.Pool, projectID, id, name string, createdAt time.Time) error {
	p, ok := pool.(*Pool)
	if !ok {
		return fmt.Errorf("postgres.InsertFlowDefinitionAt: expected *Pool, got %T", pool)
	}
	_, err := p.pool.Exec(ctx,
		`INSERT INTO zitadel_nextgen.flow_definitions (project_id, id, name, schema_version, status, purposes, definition, created_at, updated_at) `+
			`VALUES ($1, $2, $3, '1.0.0', 'draft'`+statusCast+`, '{}'`+purposeArrCast+`, '{}', $4, $4)`,
		projectID, id, name, createdAt,
	)
	return wrapError(err)
}

// InsertUserPasswordAt inserts a user_passwords row at an exact created_at.
// SetUserPassword never accepts a caller-supplied created_at, so a test that
// needs a newest password the clock has not reached yet has to write the row
// itself.
func InsertUserPasswordAt(ctx context.Context, pool database.Pool, projectID, id, userID, encodedHash string, createdAt time.Time) error {
	p, ok := pool.(*Pool)
	if !ok {
		return fmt.Errorf("postgres.InsertUserPasswordAt: expected *Pool, got %T", pool)
	}
	_, err := p.pool.Exec(ctx,
		`INSERT INTO zitadel_nextgen.user_passwords (project_id, id, user_id, encoded_hash, created_at) VALUES ($1, $2, $3, $4, $5)`,
		projectID, id, userID, encodedHash, createdAt,
	)
	return wrapError(err)
}
