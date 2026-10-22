package api

import (
	"context"

	api "github.com/zitadel/nextgen/api/generated"
)

// GetMyPlatformAccess answers which platform relations the person behind this
// session holds (ADR 075 §6), so the Console derives operator capability
// instead of probing for it (ADR 054 §10). Anyone who is not an operator gets
// an empty list, not a refusal. The session is held to project_id when the
// caller names one (requireSelf).
func (h *Handler) GetMyPlatformAccess(ctx context.Context, params api.GetMyPlatformAccessParams) (api.GetMyPlatformAccessRes, error) {
	if _, err := requireSelf(ctx, params.ProjectID); err != nil {
		return nil, err
	}
	scope, _ := GetScopeContext(ctx)
	operator, err := h.platformOperator(ctx, scope)
	if err != nil {
		return nil, err
	}
	relations := []api.PlatformAccessResponseRelationsItem{}
	if operator {
		relations = append(relations, api.PlatformAccessResponseRelationsItemOperator)
	}
	return &api.PlatformAccessResponseHeaders{
		CacheControl: api.NewOptString(sessionStateCacheControl),
		Response:     api.PlatformAccessResponse{Relations: relations},
	}, nil
}
