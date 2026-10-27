package service

import (
	"context"
	"errors"
	"slices"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ensureProjectAdminRemains refuses removal when it would leave a project with
// nobody who can administer it. A project that already has nobody in that set
// is left alone. The affected project rows are locked in project id order
// before the decisive read, so two such changes cannot both commit.
//
// Changing a grant's relation and removing a team membership have no API yet.
// Those callers should use this before the write that drops the source.
func ensureProjectAdminRemains(ctx context.Context, stmts AllStatements, removal domain.AdminRemoval) error {
	if !oneAdminRemoval(removal) {
		return domain.ErrInternal(nil).WithMessage("failed to check project administrators")
	}
	touched, err := stmts.ListProjectsTouchedByAdminRemoval(ctx, removal)
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to check project administrators")
	}
	slices.Sort(touched)
	touched = slices.Compact(touched)
	for _, projectID := range touched {
		if err := stmts.LockProject(ctx, projectID); err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				continue
			}
			return domain.ErrInternal(err).WithMessage("failed to check project administrators")
		}
	}
	if len(touched) == 0 {
		return nil
	}
	losing, err := stmts.ListProjectsLosingLastAdmin(ctx, removal)
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to check project administrators")
	}
	slices.Sort(losing)
	losing = slices.Compact(losing)
	if len(losing) == 0 {
		return nil
	}
	return domain.ErrProjectLastAdmin(losing).WithMessage(projectLastAdminMessage(losing))
}

func oneAdminRemoval(removal domain.AdminRemoval) bool {
	n := 0
	if removal.UserID != "" {
		n++
	}
	if removal.GrantID != "" {
		n++
	}
	if removal.TeamID != "" {
		n++
	}
	return n == 1
}

func projectLastAdminMessage(projectIDs []string) string {
	return "This change would leave " + strings.Join(projectIDs, ", ") + " without someone who can administer it. Grant admin to someone else, then try again."
}
