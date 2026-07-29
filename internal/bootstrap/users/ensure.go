package users

import (
	"context"
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const dialectSpanner = "spanner"

// ensureDependencies creates project, optional team, and json_schema rows required by users FKs.
func ensureDependencies(ctx context.Context, stmts service.AllStatements, h Header) error {
	if err := ensureProject(ctx, stmts, h.ProjectID); err != nil {
		return err
	}
	if h.TeamID != "" {
		if err := ensureTeam(ctx, stmts, h.ProjectID, h.TeamID); err != nil {
			return err
		}
	}
	return ensureJSONSchema(ctx, stmts, h.ProjectID, h.SchemaURL)
}

func ensureProject(ctx context.Context, stmts service.AllStatements, projectID string) error {
	_, err := stmts.GetProjectByID(ctx, projectID)
	if err == nil {
		return nil
	}
	if _, ok := errors.AsType[*database.NoRowFoundError](err); !ok {
		return fmt.Errorf("ensure project %q: %w", projectID, err)
	}

	// The bootstrap header carries no project name, so derive a placeholder
	// name from the project ID to satisfy the NOT NULL name column.
	err = stmts.CreateProject(ctx, &domain.Project{
		ID:   projectID,
		Name: "project-" + projectID,
	})
	if err != nil {
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			return nil
		}
		return fmt.Errorf("ensure project %q: %w", projectID, err)
	}
	return nil
}

func ensureTeam(ctx context.Context, stmts service.AllStatements, projectID, teamID string) error {
	if err := ensureProject(ctx, stmts, projectID); err != nil {
		return err
	}
	_, err := stmts.GetTeamByID(ctx, projectID, teamID)
	if err == nil {
		return nil
	}
	if _, ok := errors.AsType[*database.NoRowFoundError](err); !ok {
		return fmt.Errorf("ensure team %q: %w", teamID, err)
	}

	err = stmts.CreateTeam(ctx, &domain.Team{
		ProjectID: projectID,
		ID:        teamID,
	})
	if err != nil {
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			return nil
		}
		return fmt.Errorf("ensure team %q: %w", teamID, err)
	}
	return nil
}

func ensureJSONSchema(ctx context.Context, stmts service.AllStatements, projectID, schemaURL string) error {
	if err := ensureProject(ctx, stmts, projectID); err != nil {
		return err
	}
	_, err := stmts.GetJSONSchemaByID(ctx, projectID, schemaURL)
	if err == nil {
		return nil
	}
	if _, ok := errors.AsType[*database.NoRowFoundError](err); !ok {
		return fmt.Errorf("ensure json_schema %q: %w", schemaURL, err)
	}

	err = stmts.CreateJSONSchema(ctx, &domain.JSONSchema{
		ProjectID:  projectID,
		URL:        schemaURL,
		ObjectType: nil,
		Schema:     []byte("{}"),
	})
	if err != nil {
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			return nil
		}
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
