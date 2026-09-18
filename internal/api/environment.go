package api

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

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

	deployments, err := h.currentDeployments(ctx, string(params.ProjectID), result.Items)
	if err != nil {
		return nil, err
	}

	resp := api.ListEnvironmentsResponse{Environments: make([]api.Environment, len(result.Items))}
	for i, env := range result.Items {
		resp.Environments[i] = toAPIEnvironment(env, deployments)
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
	deployments, err := h.currentDeployments(ctx, string(params.ProjectID), []*domain.Environment{env})
	if err != nil {
		return nil, err
	}
	apiEnv := toAPIEnvironment(env, deployments)
	return &apiEnv, nil
}

// CreateEnvironment creates or renews a preview environment. 201 when the
// name was new, 200 when an existing preview was renewed.
func (h *Handler) CreateEnvironment(ctx context.Context, req *api.CreateEnvironmentRequest, params api.CreateEnvironmentParams) (api.CreateEnvironmentRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), environmentAccess, opWrite); err != nil {
		return nil, err
	}
	if class, ok := req.Class.Get(); ok && class != api.EnvironmentClassPreview {
		return nil, domain.ErrEnvironmentInvalid("only preview environments can be created")
	}
	ttl, err := parsePreviewTTL(req.TTL.Or(""))
	if err != nil {
		return nil, err
	}

	result, err := h.environmentService.UpsertPreview(ctx, service.UpsertPreviewEnvironmentInput{
		ProjectID: string(params.ProjectID),
		Name:      string(req.Name),
		TTL:       ttl,
		Origins:   req.Origins,
	})
	if err != nil {
		return nil, err
	}
	deployments, err := h.currentDeployments(ctx, string(params.ProjectID), []*domain.Environment{result.Environment})
	if err != nil {
		return nil, err
	}
	apiEnv := toAPIEnvironment(result.Environment, deployments)
	if result.Created {
		created := api.CreateEnvironmentCreated(apiEnv)
		return &created, nil
	}
	renewed := api.CreateEnvironmentOK(apiEnv)
	return &renewed, nil
}

// parsePreviewTTL accepts a Go duration ("168h") or a day count ("7d").
// Empty means the service default.
func parsePreviewTTL(raw string) (time.Duration, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, nil
	}
	if strings.HasSuffix(raw, "d") {
		days, err := strconv.Atoi(strings.TrimSuffix(raw, "d"))
		if err != nil || days <= 0 {
			return 0, domain.ErrEnvironmentInvalid("ttl must be a positive day count like 7d or a duration like 168h")
		}
		return time.Duration(days) * 24 * time.Hour, nil
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d <= 0 {
		return 0, domain.ErrEnvironmentInvalid("ttl must be a positive day count like 7d or a duration like 168h")
	}
	return d, nil
}

// currentDeployments hydrates the rows the environments point at, batched:
// one read for the whole page rather than one per environment, and no join —
// the list query stays single-table and keyset-safe (ADR 059).
func (h *Handler) currentDeployments(ctx context.Context, projectID string, envs []*domain.Environment) (map[string]*domain.Deployment, error) {
	ids := make([]string, 0, len(envs))
	for _, env := range envs {
		if env.CurrentDeploymentID != nil {
			ids = append(ids, *env.CurrentDeploymentID)
		}
	}
	return h.deploymentService.GetByIDs(ctx, projectID, ids)
}

/* ---------------- CONVERTERS ---------------- */

func toAPIEnvironment(env *domain.Environment, deployments map[string]*domain.Deployment) api.Environment {
	apiEnv := api.Environment{
		ID:        env.ID,
		ProjectID: api.ProjectID(env.ProjectID),
		Name:      api.EnvironmentName(env.Name),
		Class:     api.EnvironmentClass(env.Class.String()),
		Origins:   append([]string{}, env.Origins...),
		CreatedAt: env.CreatedAt,
	}
	apiEnv.ExpiresAt.SetToNull()
	if env.ExpiresAt != nil {
		apiEnv.ExpiresAt.SetTo(*env.ExpiresAt)
	}
	// Explicitly null when nothing runs here, not the zero value, which
	// would encode as an empty object.
	apiEnv.CurrentDeployment.SetToNull()
	if env.CurrentDeploymentID != nil {
		if dep, ok := deployments[*env.CurrentDeploymentID]; ok {
			apiEnv.CurrentDeployment.SetTo(api.CurrentDeployment{
				ID:         api.DeploymentID(dep.ID),
				ReleaseID:  api.ReleaseID(dep.ReleaseID),
				Reason:     api.DeploymentReason(dep.Metadata.Reason.String()),
				DeployedAt: dep.DeployedAt,
			})
		}
	}
	return apiEnv
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
	case domain.ErrEnvironmentNameInvalid().Code, domain.ErrEnvironmentInvalid(nil).Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrEnvironmentExpired().Code:
		return errorResponseWithStatusCode(http.StatusGone, err)
	case domain.ErrEnvironmentPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	default:
		return internalErrorResponse(err)
	}
}
