package service

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// projectIsClaimed reports whether a project has completed claim (ADR 046 / 049):
// the project exists and holds an active owning-team grant, the claim source
// of truth (ADR 054 §2).
func projectIsClaimed(ctx context.Context, stmts interface {
	GetProjectByID(ctx context.Context, id string) (*domain.Project, error)
	GetActiveOwningTeamGrant(ctx context.Context, projectID string) (*domain.AuthzAssignment, error)
}, projectID string) (bool, error) {
	_, err := stmts.GetProjectByID(ctx, projectID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return false, nil
		}
		return false, domain.ErrInternal(err).WithMessage("failed to load project for events visibility")
	}
	if _, err := stmts.GetActiveOwningTeamGrant(ctx, projectID); err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return false, nil
		}
		return false, domain.ErrInternal(err).WithMessage("failed to load claim grant for events visibility")
	}
	return true, nil
}
