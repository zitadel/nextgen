package api

import (
	"context"
	"net/http"
	"time"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) CreateDeployment(ctx context.Context, req *api.CreateDeploymentRequest, params api.CreateDeploymentParams) (api.CreateDeploymentRes, error) {
	projectID := string(params.ProjectID)
	if err := h.requireProjectAccess(ctx, projectID, deploymentAccess, opWrite); err != nil {
		return nil, err
	}

	// The decoder fills the schema default (deploy) when the body omits the
	// reason, and the wire enum is closed, so the parse error branch is
	// unreachable over HTTP.
	reason, err := domain.DeploymentReasonString(string(req.Reason.Or(api.DeploymentReasonDeploy)))
	if err != nil {
		return nil, domain.ErrDeploymentInvalid("unknown reason", err)
	}

	input := service.CreateDeploymentInput{
		ProjectID:  projectID,
		ReleaseRef: req.Release,
		Targets:    req.Targets,
		Reason:     reason,
		// The preview credential holds deployment.preview and not
		// deployment.write: it may register preview origins and nothing else.
		PreviewOnly: !hasGranularOrOperator(ctx, "deployment.write"),
	}
	if message, ok := req.Message.Get(); ok {
		input.Message = &message
	}
	if ttl, ok := req.TTLSeconds.Get(); ok {
		duration := time.Duration(ttl) * time.Second
		input.TTL = &duration
	}
	if expected, ok := req.ExpectedDeploymentID.Get(); ok {
		value := string(expected)
		input.ExpectedDeploymentID = &value
	}

	result, err := h.deploymentService.Create(ctx, input)
	if err != nil {
		return nil, err
	}
	// 201 only when this call wrote a deployment. Deploying what every
	// target already serves answers 200 with that deployment, so a re-run of
	// `zitadel deploy` on unchanged content is a no-op rather than a growing
	// log.
	resp := toAPIDeploymentResponse(result)
	if result.Created {
		created := api.CreateDeploymentCreated(resp)
		return &created, nil
	}
	reused := api.CreateDeploymentOK(resp)
	return &reused, nil
}

func (h *Handler) RollbackDeployment(ctx context.Context, req *api.RollbackRequest, params api.RollbackDeploymentParams) (api.RollbackDeploymentRes, error) {
	projectID := string(params.ProjectID)
	if err := h.requireProjectAccess(ctx, projectID, deploymentAccess, opWrite); err != nil {
		return nil, err
	}
	if !hasGranularOrOperator(ctx, "deployment.write") {
		return nil, domain.ErrDeploymentPermissionDenied().WithMessage("rolling back requires deployment.write")
	}

	input := service.RollbackInput{ProjectID: projectID}
	if id, ok := req.DeploymentID.Get(); ok {
		value := string(id)
		input.DeploymentID = &value
	}
	if origin, ok := req.Origin.Get(); ok {
		input.Origin = &origin
	}
	if message, ok := req.Message.Get(); ok {
		input.Message = &message
	}

	result, err := h.deploymentService.Rollback(ctx, input)
	if err != nil {
		return nil, err
	}
	resp := toAPIDeploymentResponse(result)
	return &resp, nil
}

func (h *Handler) GetDeploymentById(ctx context.Context, params api.GetDeploymentByIdParams) (api.GetDeploymentByIdRes, error) {
	// Deployments are addressed by a path id, but the read is scoped to the
	// project the caller named, so a deployment of another project reads as
	// an unknown id rather than a forbidden one and is no existence oracle.
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), deploymentAccess, opRead); err != nil {
		return nil, err
	}

	entity, err := h.deploymentService.Get(ctx, string(params.ProjectID), string(params.DeploymentID))
	if err != nil {
		return nil, err
	}
	deployment := toAPIDeployment(entity)
	return &deployment, nil
}

func (h *Handler) GetDeploymentVariables(ctx context.Context, params api.GetDeploymentVariablesParams) (api.GetDeploymentVariablesRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), deploymentAccess, opRead); err != nil {
		return nil, err
	}
	frozen, err := h.deploymentService.GetVariables(ctx, string(params.ProjectID), string(params.DeploymentID))
	if err != nil {
		return nil, err
	}
	variables := make([]*domain.Variable, len(frozen))
	for i, value := range frozen {
		variables[i] = value.Thaw()
	}
	out, err := toAPIVariables(variables)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (h *Handler) ListDeployments(ctx context.Context, params api.ListDeploymentsParams) (api.ListDeploymentsRes, error) {
	ctx, err := h.requireProjectListAccess(ctx, string(params.ProjectID), deploymentAccess, domain.ResourceKindDeployment)
	if err != nil {
		return nil, err
	}

	input := service.ListDeploymentsInput{
		ProjectID: string(params.ProjectID),
		Live:      params.Live.Or(false),
		PageToken: string(params.PageToken.Value),
		Limit:     int(params.Limit.Value),
	}
	if origin, ok := params.Origin.Get(); ok {
		input.Origin = &origin
	}
	for _, expand := range params.Expand {
		if expand == api.DeploymentExpandRelease {
			input.IncludeReleases = true
		}
	}
	// Expanding answers 403 rather than a silently missing property: a
	// caller could not tell that from a release that failed to resolve. The
	// release is a different resource under a different permission, so it is
	// gated on its own (ADR 059).
	if input.IncludeReleases {
		if err := requireReleaseRead(ctx); err != nil {
			return nil, err
		}
	}

	result, err := h.deploymentService.List(ctx, input)
	if err != nil {
		return nil, err
	}

	resp := api.ListDeploymentsResponse{Deployments: make([]api.Deployment, len(result.Items))}
	for i, entity := range result.Items {
		resp.Deployments[i] = toAPIDeployment(entity)
		if result.ReleasesByID != nil {
			if release, ok := result.ReleasesByID[entity.ReleaseID]; ok {
				resp.Deployments[i].Release = api.NewOptRelease(toAPIRelease(release))
			}
		}
	}
	if result.NextPageToken != "" {
		resp.NextPageToken = api.NewOptNilPageToken(api.PageToken(result.NextPageToken))
	}
	return &resp, nil
}

// ---- Previews --------------------------------------------------------------

func (h *Handler) ListPreviews(ctx context.Context, params api.ListPreviewsParams) (api.ListPreviewsRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), deploymentAccess, opRead); err != nil {
		return nil, err
	}
	if !hasGranularOrOperator(ctx, "preview.read") && !hasGranularOrOperator(ctx, "deployment.read") {
		return nil, domain.ErrDeploymentPermissionDenied().WithMessage("listing previews requires preview.read")
	}
	rows, err := h.deploymentService.ListPreviews(ctx, string(params.ProjectID))
	if err != nil {
		return nil, err
	}
	resp := api.ListPreviewsResponse{Previews: make([]api.Preview, len(rows))}
	for i, row := range rows {
		resp.Previews[i] = api.Preview{Origin: row.Origin, ExpiresAt: row.ExpiresAt, CreatedAt: row.CreatedAt}
	}
	return &resp, nil
}

func (h *Handler) RemovePreview(ctx context.Context, req *api.RemovePreviewReq, params api.RemovePreviewParams) (api.RemovePreviewRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), deploymentAccess, opWrite); err != nil {
		return nil, err
	}
	if !hasGranularOrOperator(ctx, "preview.delete") && !hasGranularOrOperator(ctx, "deployment.write") {
		return nil, domain.ErrDeploymentPermissionDenied().WithMessage("retiring a preview requires preview.delete")
	}
	if err := h.deploymentService.RemovePreview(ctx, string(params.ProjectID), req.Origin); err != nil {
		return nil, err
	}
	return &api.RemovePreviewNoContent{}, nil
}

/* ---------------- CONVERTERS ---------------- */

func toAPIDeploymentResponse(result *service.DeploymentOutput) api.CreateDeploymentResponse {
	resp := api.CreateDeploymentResponse{
		Deployment: toAPIDeployment(result.Deployment),
		Warnings:   result.Warnings,
	}
	if resp.Warnings == nil {
		resp.Warnings = []string{}
	}
	return resp
}

// toAPIDeployment writes absent metadata fields as explicit nulls rather
// than omitting them, so a client reading `deployed_by` finds the same shape
// whether the deployment was made by a person or by a pipeline.
func toAPIDeployment(entity *domain.Deployment) api.Deployment {
	metadata := api.DeploymentMetadata{
		Reason: api.NewOptDeploymentReason(api.DeploymentReason(entity.Metadata.Reason.String())),
	}
	if message := entity.Metadata.Message; message != nil {
		metadata.Message.SetTo(*message)
	} else {
		metadata.Message.SetToNull()
	}
	if rollbackOf := entity.Metadata.RollbackOf; rollbackOf != nil {
		metadata.RollbackOf.SetTo(api.DeploymentID(*rollbackOf))
	} else {
		metadata.RollbackOf.SetToNull()
	}
	if deployedBy := entity.Metadata.DeployedBy; deployedBy != nil {
		metadata.DeployedBy.SetTo(*deployedBy)
	} else {
		metadata.DeployedBy.SetToNull()
	}
	if actorType := entity.Metadata.DeployedByType; actorType != nil {
		metadata.DeployedByType.SetTo(api.DeploymentMetadataDeployedByType(*actorType))
	} else {
		metadata.DeployedByType.SetToNull()
	}
	targets := make([]api.DeploymentTarget, len(entity.Targets))
	for i, target := range entity.Targets {
		targets[i] = api.DeploymentTarget{Origin: target.Origin}
		if target.ExpiresAt != nil {
			targets[i].ExpiresAt.SetTo(*target.ExpiresAt)
		}
	}
	return api.Deployment{
		ID:         api.DeploymentID(entity.ID),
		ProjectID:  api.ProjectID(entity.ProjectID),
		ReleaseID:  api.ReleaseID(entity.ReleaseID),
		Targets:    targets,
		DeployedAt: entity.DeployedAt,
		Metadata:   metadata,
	}
}

// deploymentErrorResponse maps the deployment error codes onto statuses.
// dep.conflict is the failed expected_deployment_id check: the 409 details
// carry the target's actual newest deployment and release. A rollback with
// nothing to undo is the one dep.invalid that is a state conflict rather
// than a malformed request, so it answers 409 too.
func deploymentErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrDeploymentNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{}).Code:
		return errorResponseWithStatusCode(http.StatusConflict, err)
	case domain.ErrDeploymentInvalid(nil, nil).Code:
		if err.Message == service.RollbackNothingToUndo {
			return errorResponseWithStatusCode(http.StatusConflict, err)
		}
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrDeploymentPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	default:
		return internalErrorResponse(err)
	}
}

// originErrorResponse maps the origin error codes: a pattern the mode
// refuses is the caller's mistake (400), a pattern that is not there is 404.
func originErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrOriginNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrOriginPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	case domain.ErrOriginInvalid(nil).Code,
		domain.ErrOriginNotPermittedForMode(nil).Code,
		domain.ErrOriginUnbounded(nil).Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	default:
		return internalErrorResponse(err)
	}
}

// previewErrorResponse maps the preview error codes: a URL with no live
// preview is 404.
func previewErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrPreviewNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	default:
		return internalErrorResponse(err)
	}
}
