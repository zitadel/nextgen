package service

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// projectIsClaimed reports whether a project has completed claim (ADR 046 / 049):
// the project exists and resource_scope_index.team_id is set.
func projectIsClaimed(ctx context.Context, stmts interface {
	GetProjectByID(ctx context.Context, id string) (*domain.Project, error)
	GetResourceScope(ctx context.Context, resourceID string) (*domain.ResourceScope, error)
}, projectID string) (bool, error) {
	_, err := stmts.GetProjectByID(ctx, projectID)
	if err != nil {
		if errors.Is(err, new(database.NoRowFoundError)) {
			return false, nil
		}
		return false, domain.ErrInternal(err).WithMessage("failed to load project for events visibility")
	}
	scope, err := stmts.GetResourceScope(ctx, projectID)
	if err != nil {
		if errors.Is(err, new(database.NoRowFoundError)) {
			return false, nil
		}
		return false, domain.ErrInternal(err).WithMessage("failed to load project scope for events visibility")
	}
	return scope.TeamID != nil && *scope.TeamID != "", nil
}
