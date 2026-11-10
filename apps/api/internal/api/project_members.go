package api

import (
	"context"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

func (h *Handler) ListProjectMembers(ctx context.Context, params api.ListProjectMembersParams) (api.ListProjectMembersRes, error) {
	projectID := string(params.ProjectID)
	if err := h.requireProjectAccess(ctx, projectID, projectAccess, opRead); err != nil {
		return nil, err
	}
	// Stub until the members query lands (#2854 implementation).
	_ = params.Relation
	return nil, domain.ErrNotImplemented()
}
