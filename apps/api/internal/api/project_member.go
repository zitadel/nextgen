package api

import (
	"context"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// ListProjectMembers answers 501 until the members list lands (#2854).
func (h *Handler) ListProjectMembers(context.Context, api.ListProjectMembersParams) (api.ListProjectMembersRes, error) {
	return nil, domain.ErrNotImplemented()
}
