package api

import (
	"context"
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) ListEnvironments(ctx context.Context, params api.ListEnvironmentsParams) (api.ListEnvironmentsRes, error) {
	ctx, err := h.requireProjectListAccess(ctx, string(params.ProjectID), environmentAccess, domain.ResourceKindEnvironment)
	if err != nil {
		return nil, err
	}

	result, err := h.environmentService.List(ctx, service.ListEnvironmentsInput{
		ProjectID: string(params.ProjectID),
		PageToken: string(params.PageToken.Value),
		Limit:     int(params.Limit.Value),
	})
	if err != nil {
		return nil, err
	}

	resp := api.ListEnvironmentsResponse{Environments: make([]api.Environment, len(result.Items))}
	for i, env := range result.Items {
		resp.Environments[i] = toAPIEnvironment(env)
	}
	if result.NextPageToken != "" {
		resp.NextPageToken = api.NewOptNilPageToken(api.PageToken(result.NextPageToken))
	}
	return &resp, nil
}

func (h *Handler) GetEnvironmentByName(ctx context.Context, params api.GetEnvironmentByNameParams) (api.GetEnvironmentByNameRes, error) {
	// The name is not a resource id, so this cannot resolve through the
	// resource-scope index the way path-id reads do. It gates on the project
	// instead and lets the project-scoped lookup answer for the name: an
	// environment of another project is unreachable because the query is
	// filtered by this project, and reads as an unused name rather than a
	// forbidden one.
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), environmentAccess, opRead); err != nil {
		return nil, err
	}

	env, err := h.environmentService.GetByName(ctx, string(params.ProjectID), string(params.Name))
	if err != nil {
		return nil, err
	}
	apiEnv := toAPIEnvironment(env)
	return &apiEnv, nil
}

/* ---------------- CONVERTERS ---------------- */

func toAPIEnvironment(env *domain.Environment) api.Environment {
	return api.Environment{
		ID:        env.ID,
		ProjectID: api.ProjectID(env.ProjectID),
		Name:      api.EnvironmentName(env.Name),
		CreatedAt: env.CreatedAt,
	}
}

// environmentErrorResponse maps the environment error codes onto statuses.
// ErrEnvironmentNameInvalid is unreachable over HTTP — the path parameter
// declares the same pattern, so the decoder rejects a malformed name with
// req.invalid first — but it stays mapped for the in-process callers that skip
// that decoder.
func environmentErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrEnvironmentNotFound().Code, domain.ErrEnvironmentProjectNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrEnvironmentNameInvalid().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrEnvironmentPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	default:
		return internalErrorResponse(err)
	}
}
