package service

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// projectClaim is how far a project is through claim (ADR 046).
type projectClaim int

const (
	// projectGone: no such project, never created or deleted.
	projectGone projectClaim = iota
	projectUnclaimed
	projectClaimed
)

// claimStateStatements is what loadProjectClaim reads.
type claimStateStatements interface {
	GetProjectByID(ctx context.Context, id string) (*domain.Project, error)
	GetActiveOwningTeamGrant(ctx context.Context, projectID string) (*domain.AuthzAssignment, error)
}

// loadProjectClaim reads a project's claim state (ADR 046 / 049): claimed once
// it holds an active owning-team grant, the claim source of truth
// (ADR 054 §2).
func loadProjectClaim(ctx context.Context, stmts claimStateStatements, projectID string) (projectClaim, error) {
	_, err := stmts.GetProjectByID(ctx, projectID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return projectGone, nil
		}
		return projectGone, domain.ErrInternal(err).WithMessage("failed to load project claim state")
	}
	if _, err := stmts.GetActiveOwningTeamGrant(ctx, projectID); err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return projectUnclaimed, nil
		}
		return projectGone, domain.ErrInternal(err).WithMessage("failed to load project claim state")
	}
	return projectClaimed, nil
}

// projectIsClaimed reports whether a project exists and has completed claim.
func projectIsClaimed(ctx context.Context, stmts claimStateStatements, projectID string) (bool, error) {
	claim, err := loadProjectClaim(ctx, stmts, projectID)
	return claim == projectClaimed, err
}

// projectIsClaimedOrExempt is projectIsClaimed, except that the platform
// project, and every project on a server without one, are exempt.
func projectIsClaimedOrExempt(ctx context.Context, stmts claimStateStatements, platformProjectID, projectID string) (bool, error) {
	if platformProjectID == "" || projectID == platformProjectID {
		return true, nil
	}
	return projectIsClaimed(ctx, stmts, projectID)
}
