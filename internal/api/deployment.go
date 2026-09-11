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

	projectID := string(params.ProjectID)

	// Names are the wire address of an environment and stop being useful the
	// moment the request is understood, so both are resolved to ids here —
	// once, at the edge — and everything below works on ids the record keeps.
	env, err := h.environmentService.GetByName(ctx, projectID, string(req.Environment))
	if err != nil {
		return nil, err
	}
	var sourceEnvironmentID *string
	if source, ok := req.SourceEnvironment.Get(); ok {
		sourceEnv, err := h.environmentService.GetByName(ctx, projectID, string(source))
		if err != nil {
			return nil, err
		}
		sourceEnvironmentID = &sourceEnv.ID
	}

	// The decoder fills the schema default (deploy) when the body omits the
	// reason, and the wire enum is closed, so the parse error branch is
	// unreachable over HTTP.
	reason, err := domain.DeploymentReasonString(string(req.Reason.Or(api.DeploymentReasonDeploy)))
	if err != nil {
		return nil, domain.ErrDeploymentInvalid("unknown reason", err)
	}

	input := service.CreateDeploymentInput{
		ProjectID:           projectID,
		EnvironmentID:       env.ID,
		ReleaseID:           string(req.ReleaseID),
		Reason:              reason,
		SourceEnvironmentID: sourceEnvironmentID,
	}
	if expected, ok := req.ExpectedCurrentDeploymentID.Get(); ok {
		value := string(expected)
		input.ExpectedCurrentDeploymentID = &value
	}

	result, err := h.deploymentService.Create(ctx, input)
	if err != nil {
		return nil, err
	}
	// 201 only when this call made the release live. Deploying what already
	// runs answers 200 with the deployment that made it live, so a re-run of
	// `zitadel deploy` on unchanged content is a no-op rather than a growing
	// log of identical rows.
	deployment := toAPIDeployment(result.Deployment)
	if result.Created {
		created := api.CreateDeploymentCreated(deployment)
		return &created, nil
	}
	reused := api.CreateDeploymentOK(deployment)
	return &reused, nil
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

func (h *Handler) ListDeployments(ctx context.Context, params api.ListDeploymentsParams) (api.ListDeploymentsRes, error) {
	ctx, err := h.requireProjectListAccess(ctx, string(params.ProjectID), deploymentAccess, domain.ResourceKindDeployment)
	if err != nil {
		return nil, err
	}

	input := service.ListDeploymentsInput{
		ProjectID: string(params.ProjectID),
		PageToken: string(params.PageToken.Value),
		Limit:     int(params.Limit.Value),
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
	// The filter resolves like every other environment address: a name
	// nothing answers to is env.not_found rather than an empty history.
	if name, ok := params.EnvironmentName.Get(); ok {
		env, err := h.environmentService.GetByName(ctx, string(params.ProjectID), string(name))
		if err != nil {
			return nil, err
		}
		input.EnvironmentID = &env.ID
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

/* ---------------- CONVERTERS ---------------- */

// toAPIDeployment writes absent metadata fields as explicit nulls rather
// than omitting them, so a client reading `deployed_by` finds the same shape
// whether the deployment was made by a person or by a pipeline.
func toAPIDeployment(entity *domain.Deployment) api.Deployment {
	metadata := api.DeploymentMetadata{
		Reason: api.NewOptDeploymentReason(api.DeploymentReason(entity.Metadata.Reason.String())),
	}
	if source := entity.Metadata.SourceEnvironmentID; source != nil {
		metadata.SourceEnvironmentID.SetTo(*source)
	} else {
		metadata.SourceEnvironmentID.SetToNull()
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
	return api.Deployment{
		ID:            api.DeploymentID(entity.ID),
		ProjectID:     api.ProjectID(entity.ProjectID),
		EnvironmentID: entity.EnvironmentID,
		ReleaseID:     api.ReleaseID(entity.ReleaseID),
		DeployedAt:    entity.DeployedAt,
		Metadata:      metadata,
	}
}

// deploymentErrorResponse maps the deployment error codes onto statuses.
// dep.conflict is the failed expected_current_deployment_id check: the 409
// details carry the environment's actual current deployment and release.
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
