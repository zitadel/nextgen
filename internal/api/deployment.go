package api

import (
	"context"
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) CreateDeployment(ctx context.Context, req *api.CreateDeploymentRequest, params api.CreateDeploymentParams) (api.CreateDeploymentRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), deploymentAccess, opWrite); err != nil {
		return nil, err
	}

	// Naming the release by its digest lands with #1574.
	if req.ContentHash.Set {
		return nil, domain.ErrNotImplemented()
	}
	input := service.DeployInput{
		ProjectID: string(params.ProjectID),
		ReleaseID: string(req.ReleaseID.Value),
		Targets:   req.Targets,
	}
	if ttl, ok := req.TTL.Get(); ok {
		parsed, err := domain.ParsePreviewTTL(string(ttl))
		if err != nil {
			return nil, err
		}
		input.TTL = &parsed
	}
	if reason, ok := req.Reason.Get(); ok {
		parsed, err := domain.DeploymentReasonString(string(reason))
		if err != nil {
			return nil, domain.ErrDeploymentInvalid("unknown reason", err)
		}
		input.Reason = parsed
	}
	if message, ok := req.Message.Get(); ok {
		input.Message = &message
	}
	if expected, ok := req.ExpectedDeploymentID.Get(); ok {
		input.ExpectedDeploymentID = new(string(expected))
	}

	result, err := h.deploymentService.Deploy(ctx, input)
	if err != nil {
		return nil, err
	}
	resp := toAPIDeploymentWritten(result)
	if result.Created {
		return (*api.CreateDeploymentCreated)(&resp), nil
	}
	return (*api.CreateDeploymentOK)(&resp), nil
}

// RollbackDeployment answers 501 until rollback lands. The access check stays
// in front, so a caller without the permission learns that first.
func (h *Handler) RollbackDeployment(ctx context.Context, _ api.OptRollbackDeploymentRequest, params api.RollbackDeploymentParams) (api.RollbackDeploymentRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), deploymentAccess, opWrite); err != nil {
		return nil, err
	}
	return nil, domain.ErrNotImplemented()
}

// The reads answer 501 until they land on top of the deploy. The access
// check stays in front, so a caller without the permission learns that first.

func (h *Handler) GetDeploymentById(ctx context.Context, params api.GetDeploymentByIdParams) (api.GetDeploymentByIdRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), deploymentAccess, opRead); err != nil {
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

// toAPIDeploymentWritten converts a create result; every target of a written
// preview deployment carries the expiry it set.
func toAPIDeploymentWritten(result *service.CreateDeploymentOutput) api.Deployment {
	resp := toAPIDeployment(result.Deployment)
	if result.PreviewExpiresAt != nil {
		for i := range resp.Targets {
			resp.Targets[i].ExpiresAt = api.NewOptDateTime(*result.PreviewExpiresAt)
		}
	}
	return resp
}

// toAPIDeployment converts a deployment.
func toAPIDeployment(entity *domain.Deployment) api.Deployment {
	resp := api.Deployment{
		ID:         api.DeploymentID(entity.ID),
		ProjectID:  api.ProjectID(entity.ProjectID),
		ReleaseID:  api.ReleaseID(entity.ReleaseID),
		Targets:    make([]api.DeploymentTarget, len(entity.Targets)),
		DeployedAt: entity.DeployedAt,
		Metadata: api.DeploymentMetadata{
			Reason: api.DeploymentReason(entity.Metadata.Reason.String()),
		},
	}
	for i, target := range entity.Targets {
		resp.Targets[i] = api.DeploymentTarget{Origin: api.Origin(target.Origin)}
	}
	if m := entity.Metadata; m.Message != nil {
		resp.Metadata.Message = api.NewOptNilString(*m.Message)
	}
	if m := entity.Metadata; m.RollbackTo != nil {
		resp.Metadata.RollbackTo = api.NewOptNilDeploymentID(api.DeploymentID(*m.RollbackTo))
	}
	if m := entity.Metadata; m.DeployedBy != nil {
		resp.Metadata.DeployedBy = api.NewOptNilString(*m.DeployedBy)
	}
	if m := entity.Metadata; m.DeployedByType != nil {
		resp.Metadata.DeployedByType = api.NewOptNilDeploymentMetadataDeployedByType(api.DeploymentMetadataDeployedByType(*m.DeployedByType))
	}
	return resp
}
