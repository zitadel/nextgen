package api

import (
	"context"
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// The deployment operations answer 501 until the deployment service deploys
// to targets. The access check stays in front, so a caller without the
// permission learns that before it learns the operation is not served yet.

func (h *Handler) CreateDeployment(ctx context.Context, _ *api.CreateDeploymentRequest, params api.CreateDeploymentParams) (api.CreateDeploymentRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), deploymentAccess, opWrite); err != nil {
		return nil, err
	}
	return nil, domain.ErrNotImplemented()
}

func (h *Handler) RollbackDeployment(ctx context.Context, _ api.OptRollbackDeploymentRequest, params api.RollbackDeploymentParams) (api.RollbackDeploymentRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), deploymentAccess, opWrite); err != nil {
		return nil, err
	}
	return nil, domain.ErrNotImplemented()
}

func (h *Handler) GetDeploymentById(ctx context.Context, params api.GetDeploymentByIdParams) (api.GetDeploymentByIdRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), deploymentAccess, opRead); err != nil {
		return nil, err
	}
	return nil, domain.ErrNotImplemented()
}

func (h *Handler) GetDeploymentVariables(ctx context.Context, params api.GetDeploymentVariablesParams) (api.GetDeploymentVariablesRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), deploymentAccess, opRead); err != nil {
		return nil, err
	}
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), variableAccess, opRead); err != nil {
		return nil, err
	}
	return nil, domain.ErrNotImplemented()
}

func (h *Handler) ListDeployments(ctx context.Context, params api.ListDeploymentsParams) (api.ListDeploymentsRes, error) {
	ctx, _, err := h.requireProjectListAccess(ctx, string(params.ProjectID), deploymentAccess, domain.ResourceKindDeployment)
	if err != nil {
		return nil, err
	}
	for _, expand := range params.Expand {
		if expand == api.DeploymentExpandRelease {
			if err := requireReleaseRead(ctx); err != nil {
				return nil, err
			}
		}
	}
	return nil, domain.ErrNotImplemented()
}

func (h *Handler) ListPreviews(ctx context.Context, params api.ListPreviewsParams) (api.ListPreviewsRes, error) {
	ctx, _, err := h.requireProjectListAccess(ctx, string(params.ProjectID), deploymentAccess, domain.ResourceKindDeployment)
	if err != nil {
		return nil, err
	}

	result, err := h.deploymentService.ListPreviews(ctx, service.ListPreviewsInput{
		ProjectID: string(params.ProjectID),
		PageToken: string(params.PageToken.Value),
		Limit:     int(params.Limit.Value),
	})
	if err != nil {
		return nil, err
	}

	resp := api.ListPreviewsResponse{Previews: make([]api.Preview, len(result.Items))}
	for i, entity := range result.Items {
		resp.Previews[i] = api.Preview{
			Origin:    api.Origin(entity.Origin),
			ExpiresAt: entity.ExpiresAt,
			CreatedAt: entity.CreatedAt,
		}
	}
	if result.NextPageToken != "" {
		resp.NextPageToken = api.NewOptNilPageToken(api.PageToken(result.NextPageToken))
	}
	return &resp, nil
}

func (h *Handler) RemovePreview(ctx context.Context, req *api.RemovePreviewRequest, params api.RemovePreviewParams) (api.RemovePreviewRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), deploymentAccess, opWrite); err != nil {
		return nil, err
	}
	if err := h.deploymentService.RemovePreview(ctx, string(params.ProjectID), string(req.Origin)); err != nil {
		return nil, err
	}
	return &api.RemovePreviewNoContent{}, nil
}

// deploymentErrorResponse maps the deployment error codes onto statuses.
// dep.conflict is the failed expected_deployment_id check: the 409 details
// carry the actual newest deployment to the targets.
func deploymentErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrDeploymentNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{}).Code:
		return errorResponseWithStatusCode(http.StatusConflict, err)
	case domain.ErrDeploymentInvalid(nil, nil).Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrDeploymentPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	default:
		return internalErrorResponse(err)
	}
}
