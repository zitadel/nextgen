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
	// 201 only when this call wrote rows. Deploying what every target already
	// serves answers 200 with those rows, so a re-run of `zitadel deploy` on
	// unchanged content is a no-op rather than a growing log.
	resp := toAPIDeploy(result)
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
	if id, ok := req.DeployID.Get(); ok {
		input.DeployID = &id
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
	resp := toAPIDeploy(result)
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
	deployment := toAPIDeployment(entity, nil)
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
	if deployID, ok := params.DeployID.Get(); ok {
		input.DeployID = &deployID
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
		var expires *time.Time
		if at, ok := result.ExpiresAt[entity.Origin]; ok {
			expires = &at
		}
		resp.Deployments[i] = toAPIDeployment(entity, expires)
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

// ---- Origins ---------------------------------------------------------------

func (h *Handler) ListOrigins(ctx context.Context, params api.ListOriginsParams) (api.ListOriginsRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), deploymentAccess, opRead); err != nil {
		return nil, err
	}
	rows, err := h.deploymentService.ListOrigins(ctx, string(params.ProjectID))
	if err != nil {
		return nil, err
	}
	resp := api.ListOriginsResponse{Origins: make([]api.Origin, len(rows))}
	for i, row := range rows {
		resp.Origins[i] = api.Origin{Origin: row.Origin, ExpiresAt: row.ExpiresAt, CreatedAt: row.CreatedAt}
	}
	return &resp, nil
}

func (h *Handler) RemoveOrigin(ctx context.Context, req *api.RemoveOriginReq, params api.RemoveOriginParams) (api.RemoveOriginRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), deploymentAccess, opWrite); err != nil {
		return nil, err
	}
	if !hasGranularOrOperator(ctx, "deployment.write") {
		return nil, domain.ErrDeploymentPermissionDenied().WithMessage("retiring an origin requires deployment.write")
	}
	if err := h.deploymentService.RemoveOrigin(ctx, string(params.ProjectID), req.Origin); err != nil {
		return nil, err
	}
	return &api.RemoveOriginNoContent{}, nil
}

/* ---------------- CONVERTERS ---------------- */

func toAPIDeploy(result *service.DeploymentOutput) api.DeployResponse {
	resp := api.DeployResponse{
		DeployID:    result.DeployID,
		Targets:     result.Targets,
		Deployments: make([]api.Deployment, len(result.Rows)),
		Warnings:    result.Warnings,
	}
	if result.Release != nil {
		resp.ReleaseID = api.ReleaseID(result.Release.ID)
	}
	if resp.Targets == nil {
		resp.Targets = []string{}
	}
	if resp.Warnings == nil {
		resp.Warnings = []string{}
	}
	for i, row := range result.Rows {
		resp.Deployments[i] = toAPIDeployment(row, nil)
	}
	return resp
}

// toAPIDeployment writes absent metadata fields as explicit nulls rather
// than omitting them, so a client reading `deployed_by` finds the same shape
// whether the deployment was made by a person or by a pipeline.
func toAPIDeployment(entity *domain.Deployment, expiresAt *time.Time) api.Deployment {
	metadata := api.DeploymentMetadata{
		Reason: api.NewOptDeploymentReason(api.DeploymentReason(entity.Metadata.Reason.String())),
	}
	if message := entity.Metadata.Message; message != nil {
		metadata.Message.SetTo(*message)
	} else {
		metadata.Message.SetToNull()
	}
	if rollbackOf := entity.Metadata.RollbackOf; rollbackOf != nil {
		metadata.RollbackOf.SetTo(*rollbackOf)
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
	deployment := api.Deployment{
		ID:         api.DeploymentID(entity.ID),
		ProjectID:  api.ProjectID(entity.ProjectID),
		DeployID:   entity.DeployID,
		Origin:     entity.Origin,
		ReleaseID:  api.ReleaseID(entity.ReleaseID),
		DeployedAt: entity.DeployedAt,
		Metadata:   metadata,
	}
	if expiresAt != nil {
		deployment.ExpiresAt.SetTo(*expiresAt)
	}
	return deployment
}

// deploymentErrorResponse maps the deployment error codes onto statuses.
// dep.conflict is the failed expected_deployment_id check: the 409 details
// carry the target's actual newest deployment and release.
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

// originErrorResponse maps the origin error codes: a pattern the class
// refuses is the caller's mistake (400), a row that is not there is 404.
func originErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrOriginNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrOriginPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	case domain.ErrOriginInvalid(nil).Code,
		domain.ErrOriginNotPermittedForClass(nil).Code,
		domain.ErrOriginUnbounded(nil).Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	default:
		return internalErrorResponse(err)
	}
}
