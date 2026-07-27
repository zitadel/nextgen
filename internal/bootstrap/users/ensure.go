package users

import (
	"context"
	"fmt"

	"github.com/zitadel/nextgen/internal/storage/database"
)

const dialectSpanner = "spanner"

// ensureDependencies creates project, optional team, and json_schema rows required by users FKs.
func ensureDependencies(ctx context.Context, client database.QueryExecutor, h Header) error {
	if err := ensureProject(ctx, client, h.ProjectID); err != nil {
		return err
	}
	if h.TeamID != "" {
		if err := ensureTeam(ctx, client, h.ProjectID, h.TeamID); err != nil {
			return err
		}
	}
	return ensureJSONSchema(ctx, client, h.ProjectID, h.SchemaURL)
}

func ensureProject(ctx context.Context, client database.QueryExecutor, projectID string) error {
	// The bootstrap header carries no project name, so derive a placeholder
	// name from the project ID to satisfy the NOT NULL name column.
	_, err := client.Exec(ctx,
		`INSERT INTO zitadel_nextgen.projects (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
		projectID, "project-"+projectID,
	)
	if err != nil {
		return fmt.Errorf("ensure project %q: %w", projectID, err)
	}
	return nil
}

func ensureTeam(ctx context.Context, client database.QueryExecutor, projectID, teamID string) error {
	if err := ensureProject(ctx, client, projectID); err != nil {
		return err
	}
	_, err := client.Exec(ctx,
		`INSERT INTO zitadel_nextgen.teams (project_id, id) VALUES ($1, $2) ON CONFLICT (project_id, id) DO NOTHING`,
		projectID, teamID,
	)
	if err != nil {
		return fmt.Errorf("ensure team %q: %w", teamID, err)
	}
	return nil
}

func ensureJSONSchema(ctx context.Context, client database.QueryExecutor, projectID, schemaURL string) error {
	if err := ensureProject(ctx, client, projectID); err != nil {
		return err
	}
	_, err := client.Exec(ctx,
		`INSERT INTO zitadel_nextgen.json_schemas (project_id, url, payload) VALUES ($1, $2, $3::json) ON CONFLICT (project_id, url) DO NOTHING`,
		projectID, schemaURL, []byte("{}"),
	)
	if err != nil {
		return fmt.Errorf("ensure json_schema %q: %w", schemaURL, err)
	}
	return nil
}

func checkDialectSupported(dialect string) error {
	if dialect == dialectSpanner {
		return fmt.Errorf("user bootstrap is not supported for dialect %q yet", dialect)
	}
	return nil
}
