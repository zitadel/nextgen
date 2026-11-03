package service

import (
	"context"
	"errors"
	"slices"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ensureProjectOwnerRemains refuses removing userID when they are the last
// active member of a project's owning team (ADR 054 §8). Admin grants stay
// freely revocable, and suspending or deactivating a user is never refused:
// the way back from an ownerless team is #1261's recovery. A project whose
// owning team already has no active member is left alone. The affected project
// rows are locked in project id order before the decisive read, so two such
// removals cannot both commit.
//
// Removing a team membership has no API yet. That caller should use this
// before the write that drops the membership.
func ensureProjectOwnerRemains(ctx context.Context, stmts AllStatements, userID string) error {
	owned, err := stmts.ListProjectsOwnedThroughMember(ctx, userID)
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to check project owners")
	}
	if len(owned) == 0 {
		return nil
	}
	slices.Sort(owned)
	owned = slices.Compact(owned)
	for _, projectID := range owned {
		if err := stmts.LockProject(ctx, projectID); err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				continue
			}
			return domain.ErrInternal(err).WithMessage("failed to check project owners")
		}
	}
	losing, err := stmts.ListProjectsLosingLastOwner(ctx, userID)
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to check project owners")
	}
	if len(losing) == 0 {
		return nil
	}
	slices.Sort(losing)
	losing = slices.Compact(losing)
	return domain.ErrProjectLastOwner(losing).WithMessage(projectLastOwnerMessage(losing))
}

func projectLastOwnerMessage(projectIDs []string) string {
	return "This user is the last active member of the team that owns " + strings.Join(projectIDs, ", ") + ". Add another member to that team, then try again."
}
