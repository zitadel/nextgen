//go:build spanner_integration

package spanner

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

// HardDeleteTeam deletes a team row so stmttest can assert ON DELETE CASCADE
// behavior. There is no product DeleteTeam statement (only soft deactivate).
func HardDeleteTeam(ctx context.Context, pool database.Pool, projectID, teamID string) error {
	c, ok := pool.(*Client)
	if !ok {
		return fmt.Errorf("spanner.HardDeleteTeam: expected *Client, got %T", pool)
	}
	db := newClientDB(c.client)
	_, err := db.Update(ctx, buildStatement(
		`DELETE FROM teams WHERE project_id = @p1 AND id = @p2`,
		projectID, teamID,
	).statement())
	return err
}

// InsertJSONSchemaAt inserts a json_schemas row at an exact created_at.
// CreateJSONSchema takes the timestamp from the database, so a test that needs
// two revisions to collide has to write the row itself.
func InsertJSONSchemaAt(ctx context.Context, pool database.Pool, projectID, url string, objectType *string, createdAt time.Time) error {
	c, ok := pool.(*Client)
	if !ok {
		return fmt.Errorf("spanner.InsertJSONSchemaAt: expected *Client, got %T", pool)
	}
	db := newClientDB(c.client)
	_, err := db.Update(ctx, buildStatement(
		`INSERT INTO json_schemas (project_id, url, object_type, kind, created_at, payload) VALUES (@p1, @p2, @p3, @p4, @p5, JSON '{}')`,
		projectID, url, objectType, domain.JSONSchemaKindUnknown.String(), createdAt,
	).statement())
	return wrapError(err)
}
