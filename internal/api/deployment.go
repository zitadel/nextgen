package api

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"time"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) CreateDeployment(ctx context.Context, req *api.CreateDeploymentRequest, params api.CreateDeploymentParams) (api.CreateDeploymentRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), deploymentAccess, opWrite); err != nil {
		return nil, err
	}

	// Not in the schema: ogen cannot generate an exactly-one constraint.
	if req.ReleaseID.Set == req.ContentHash.Set {
		return nil, domain.ErrDeploymentInvalid().WithMessage("name the release by exactly one of release_id and content_hash")
	}
	// TODO(#1574): look the release up by its digest.
	if req.ContentHash.Set {
		return nil, domain.ErrNotImplemented()
	}
	input := service.DeployInput{
		ProjectID: string(params.ProjectID),
		ReleaseID: string(req.ReleaseID.Value),
		Targets:   req.Targets,
	}
	if ttl, ok := req.TTL.Get(); ok {
		input.TTL = new(time.Duration(ttl))
	}
	if reason, ok := req.Reason.Get(); ok {
		parsed, err := domain.DeploymentReasonString(string(reason))
		if err != nil {
			return nil, domain.ErrDeploymentInvalid().WithMessage("unknown reason").WithParent(err)
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
	if conflict, ok := deploymentConflictResponse(err); ok {
		return conflict, nil
	}
	if missing, ok := deploymentVariablesMissingResponse(err); ok {
		return missing, nil
	}
	if err != nil {
		return nil, err
	}
	// Created or not, the deployment is the newest to its targets.
	resp := toAPIDeployment(result.Deployment, api.DeploymentStatusLive)
	if result.Created {
		created := api.CreateDeploymentCreated(resp)
		return &created, nil
	}
	unchanged := api.CreateDeploymentOK(resp)
	return &unchanged, nil
}

func (h *Handler) RollbackDeployment(ctx context.Context, req api.OptRollbackDeploymentRequest, params api.RollbackDeploymentParams) (api.RollbackDeploymentRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), deploymentAccess, opWrite); err != nil {
		return nil, err
	}

	input := service.RollbackDeploymentInput{
		ProjectID:    string(params.ProjectID),
		DeploymentID: string(params.DeploymentID),
	}
	if body, ok := req.Get(); ok {
		if message, ok := body.Message.Get(); ok {
			input.Message = &message
		}
		if expected, ok := body.ExpectedDeploymentID.Get(); ok {
			input.ExpectedDeploymentID = new(string(expected))
		}
	}

	result, err := h.deploymentService.Rollback(ctx, input)
	if conflict, ok := deploymentConflictResponse(err); ok {
		return conflict, nil
	}
	if err != nil {
		return nil, err
	}
	// Created or not, the deployment is the project's newest primary one.
	resp := toAPIDeployment(result.Deployment, api.DeploymentStatusLive)
	if result.Created {
		created := api.RollbackDeploymentCreated(resp)
		return &created, nil
	}
	unchanged := api.RollbackDeploymentOK(resp)
	return &unchanged, nil
}

func (h *Handler) GetDeploymentById(ctx context.Context, params api.GetDeploymentByIdParams) (api.GetDeploymentByIdRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), deploymentAccess, opRead); err != nil {
		return nil, err
	}
	entity, live, err := h.deploymentService.Read(ctx, string(params.ProjectID), string(params.DeploymentID))
	if err != nil {
		return nil, err
	}
	resp := toAPIDeployment(entity, toAPIDeploymentStatus(live))
	return &resp, nil
}

func (h *Handler) GetDeploymentVariables(ctx context.Context, params api.GetDeploymentVariablesParams) (api.GetDeploymentVariablesRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), deploymentAccess, opRead); err != nil {
		return nil, err
	}
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), variableAccess, opRead); err != nil {
		return nil, err
	}
	set, err := h.deploymentService.Variables(ctx, string(params.ProjectID), string(params.DeploymentID))
	if err != nil {
		return nil, err
	}
	out := make(api.Variables, len(set.Entries))
	for _, variable := range set.Variables() {
		rendered, err := toAPIVariable(variable)
		if err != nil {
			return nil, err
		}
		out[variable.Name] = rendered
	}
	return &out, nil
}

func (h *Handler) ListDeployments(ctx context.Context, params api.ListDeploymentsParams) (api.ListDeploymentsRes, error) {
	ctx, _, err := h.requireProjectListAccess(ctx, string(params.ProjectID), deploymentAccess, domain.ResourceKindDeployment)
	if err != nil {
		return nil, err
	}
	includeReleases := slices.Contains(params.Expand, api.DeploymentExpandRelease)
	if includeReleases {
		if err := requireReleaseRead(ctx); err != nil {
			return nil, err
		}
	}

	input := service.ListDeploymentsInput{
		ProjectID:       string(params.ProjectID),
		Live:            params.Live.Value,
		IncludeReleases: includeReleases,
		PageToken:       string(params.PageToken.Value),
		Limit:           int(params.Limit.Value),
	}
	if origin, ok := params.Origin.Get(); ok {
		input.Origin = new(string(origin))
	}
	result, err := h.deploymentService.List(ctx, input)
	if err != nil {
		return nil, err
	}

	resp := api.ListDeploymentsResponse{Deployments: make([]api.Deployment, len(result.Items))}
	for i, entity := range result.Items {
		resp.Deployments[i] = toAPIDeployment(entity, toAPIDeploymentStatus(result.Live[entity.ID]))
		if release, ok := result.ReleasesByID[entity.ReleaseID]; ok {
			resp.Deployments[i].Release = api.NewOptRelease(toAPIRelease(release))
		}
	}
	if result.NextPageToken != "" {
		resp.NextPageToken = api.NewOptNilPageToken(api.PageToken(result.NextPageToken))
	}
	return &resp, nil
}

func (h *Handler) ListPreviews(ctx context.Context, params api.ListPreviewsParams) (api.ListPreviewsRes, error) {
	// A preview has no id for a list filter to scope, so access is
	// project-wide or nothing.
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), deploymentAccess, opRead); err != nil {
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

// deploymentConflictResponse answers dep.conflict with the typed 409, whose
// details.deployment is the deployment the write replaces. Through NewError
// the details would nest under details.details.
func deploymentConflictResponse(err error) (*api.DeploymentConflict, bool) {
	de, ok := errors.AsType[domain.Error](err)
	if !ok {
		return nil, false
	}
	if de.Code == domain.ErrReleaseRevoked().Code {
		resp := api.NewReleaseRevokedConflictDeploymentConflict(api.ReleaseRevokedConflict{Code: de.Code, Message: de.Message})
		return &resp, true
	}
	if de.Code != domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{}).Code {
		return nil, false
	}
	body := api.DeploymentGuardConflict{Code: de.Code, Message: de.Message}
	if details, _ := de.Details.(domain.DeploymentConflictDetails); details.Deployment != nil {
		// The deployment a write replaces is the newest one.
		body.Details.Deployment = api.NewNilDeployment(toAPIDeployment(details.Deployment, api.DeploymentStatusLive))
	} else {
		body.Details.Deployment.SetToNull()
	}
	resp := api.NewDeploymentGuardConflictDeploymentConflict(body)
	return &resp, true
}

// deploymentVariablesMissingResponse answers dep.variables_missing with the
// typed 400, whose details.kind and details.names sit on the body. Through
// NewError the details would nest under details.details.
func deploymentVariablesMissingResponse(err error) (*api.CreateDeploymentBadRequest, bool) {
	de, ok := errors.AsType[domain.Error](err)
	if !ok || de.Code != domain.ErrDeploymentVariablesMissing(domain.DeploymentOriginKindPrimary, nil).Code {
		return nil, false
	}
	details, ok := de.Details.(domain.DeploymentVariablesMissingDetails)
	if !ok {
		return nil, false
	}
	resp := api.NewDeploymentVariablesMissingCreateDeploymentBadRequest(api.DeploymentVariablesMissing{
		Code:    de.Code,
		Message: de.Message,
		Details: api.DeploymentVariablesMissingDetails{
			Kind:  api.DeploymentKind(details.Kind),
			Names: details.Names,
		},
	})
	return &resp, true
}

// deploymentErrorResponse maps the deployment error codes onto statuses.
// dep.conflict is the failed expected_deployment_id check: the 409 details
// carry the deployment the write would replace.
func deploymentErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrDeploymentNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{}).Code:
		return errorResponseWithStatusCode(http.StatusConflict, err)
	case domain.ErrDeploymentInvalid().Code, domain.ErrDeploymentVariablesMissing(domain.DeploymentOriginKindPrimary, nil).Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrDeploymentPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	default:
		return internalErrorResponse(err)
	}
}

func toAPIDeploymentStatus(live bool) api.DeploymentStatus {
	if live {
		return api.DeploymentStatusLive
	}
	return api.DeploymentStatusInactive
}

// toAPIDeployment converts a deployment.
func toAPIDeployment(entity *domain.Deployment, status api.DeploymentStatus) api.Deployment {
	resp := api.Deployment{
		ID:         api.DeploymentID(entity.ID),
		ProjectID:  api.ProjectID(entity.ProjectID),
		ReleaseID:  api.ReleaseID(entity.ReleaseID),
		Kind:       api.DeploymentKind(entity.OriginKind.String()),
		Targets:    make([]api.DeploymentTarget, len(entity.Targets)),
		Status:     status,
		DeployedAt: entity.DeployedAt,
		Metadata: api.DeploymentMetadata{
			Reason: api.DeploymentReason(entity.Metadata.Reason.String()),
		},
	}
	for i, target := range entity.Targets {
		resp.Targets[i] = api.DeploymentTarget{Origin: api.Origin(target.Origin)}
	}
	m := entity.Metadata
	if m.Message != nil {
		resp.Metadata.Message = api.NewOptNilString(*m.Message)
	}
	if m.RollbackTo != nil {
		resp.Metadata.RollbackTo = api.NewOptNilDeploymentID(api.DeploymentID(*m.RollbackTo))
	}
	if m.DeployedBy != nil {
		resp.Metadata.DeployedBy = api.NewOptNilString(*m.DeployedBy)
	}
	if m.DeployedByType != nil {
		resp.Metadata.DeployedByType = api.NewOptNilDeploymentMetadataDeployedByType(api.DeploymentMetadataDeployedByType(*m.DeployedByType))
	}
	return resp
}
