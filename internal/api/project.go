package api

import (
	"context"
	"net/url"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) CreateProject(ctx context.Context, req *api.CreateProjectRequest, params api.CreateProjectParams) (api.CreateProjectRes, error) {
	idempotencyKey, _ := params.IdempotencyKey.Get()
	project, err := h.projectService.CreateWithIdempotency(ctx, req.PreviewOrigins, idempotencyKey)
	if err != nil {
		return h.NewError(ctx, err), nil
	}
	return &api.CreateProjectResponse{
		ProjectID:        api.ProjectID(project.ID),
		ProjectSecret:    project.ProjectSecret,
		PreviewSecret:    project.PreviewSecret,
		PreviewOrigins:   project.PreviewOrigins,
		Lifecycle:        createProjectLifecycle(project.Lifecycle),
		ClaimRequiredFor: createClaimRequiredFor(project),
		CreatedAt:        project.CreatedAt,
	}, nil
}

func (h *Handler) GetProject(ctx context.Context, params api.GetProjectParams) (api.GetProjectRes, error) {
	projectID := string(params.ProjectID)
	scopeCtx, err := h.requireBearerProject(ctx, projectID)
	if err != nil {
		return h.NewError(ctx, err), nil
	}
	project, err := h.projectService.Get(ctx, projectID)
	if err != nil {
		return h.NewError(ctx, err), nil
	}
	if scopeCtx.ProjectSecret != project.ProjectSecret {
		return h.NewError(ctx, domain.ErrAuthUnauthorized(nil)), nil
	}
	return getProjectResponse(project), nil
}

func (h *Handler) ApplyProjectConfig(ctx context.Context, _ api.OptApplyProjectConfigReq, params api.ApplyProjectConfigParams) (api.ApplyProjectConfigRes, error) {
	scopeCtx, _ := GetScopeContext(ctx)
	if _, err := h.requireBearerProject(ctx, string(params.ProjectID)); err != nil {
		return h.NewError(ctx, err), nil
	}
	applied, err := h.projectService.ApplyConfig(ctx, service.ApplyProjectConfigInput{
		ProjectID:     string(params.ProjectID),
		ProjectSecret: scopeCtx.ProjectSecret,
		Environment:   service.ProjectEnvironment(params.Environment),
	})
	if err != nil {
		return h.NewError(ctx, err), nil
	}
	return &api.ApplyProjectConfigOK{
		ProjectID:   api.ProjectID(applied.Project.ID),
		Environment: api.ApplyProjectConfigOKEnvironment(applied.Environment),
		Lifecycle:   api.ApplyProjectConfigOKLifecycle(applied.Project.Lifecycle),
		AppliedAt:   applied.AppliedAt,
	}, nil
}

func (h *Handler) InitProjectClaim(ctx context.Context, req api.OptInitProjectClaimReq, params api.InitProjectClaimParams) (api.InitProjectClaimRes, error) {
	scopeCtx, _ := GetScopeContext(ctx)
	if _, err := h.requireBearerProject(ctx, string(params.ProjectID)); err != nil {
		return h.NewError(ctx, err), nil
	}
	body, _ := req.Get()
	returnURL := ""
	if u, ok := body.ReturnURL.Get(); ok {
		returnURL = u.String()
	}
	suggestedTeamName, _ := body.SuggestedTeamName.Get()
	challenge, err := h.projectService.InitClaim(ctx, service.InitProjectClaimInput{
		ProjectID:         string(params.ProjectID),
		ProjectSecret:     scopeCtx.ProjectSecret,
		ReturnURL:         returnURL,
		SuggestedTeamName: suggestedTeamName,
	})
	if err != nil {
		return h.NewError(ctx, err), nil
	}
	claimURL, err := url.Parse(challenge.ClaimURL)
	if err != nil {
		return h.NewError(ctx, domain.ErrInternal(err)), nil
	}
	return &api.InitProjectClaimCreated{
		ProjectID:   api.ProjectID(challenge.ProjectID),
		ChallengeID: challenge.ChallengeID,
		ClaimURL:    *claimURL,
		ExpiresAt:   challenge.ExpiresAt,
		Status:      api.InitProjectClaimCreatedStatusPending,
	}, nil
}

func (h *Handler) CompleteProjectClaim(ctx context.Context, req *api.CompleteProjectClaimReq, params api.CompleteProjectClaimParams) (api.CompleteProjectClaimRes, error) {
	if _, err := h.requireBearerProject(ctx, string(params.ProjectID)); err != nil {
		return h.NewError(ctx, err), nil
	}
	teamID := ""
	createTeamName := ""
	if choice, ok := req.TeamChoice.Get(); ok {
		teamID, _ = choice.TeamID.Get()
		createTeamName, _ = choice.CreateTeamName.Get()
	}
	project, err := h.projectService.CompleteClaim(ctx, service.CompleteProjectClaimInput{
		ProjectID:      string(params.ProjectID),
		ChallengeID:    req.ChallengeID,
		TeamID:         teamID,
		CreateTeamName: createTeamName,
	})
	if err != nil {
		return h.NewError(ctx, err), nil
	}
	claimedAt := project.CreatedAt
	if project.ClaimedAt != nil {
		claimedAt = *project.ClaimedAt
	}
	return &api.CompleteProjectClaimOK{
		ProjectID: api.ProjectID(project.ID),
		Lifecycle: api.CompleteProjectClaimOKLifecycleClaimed,
		TeamID:    project.TeamID,
		Tier:      api.CompleteProjectClaimOKTier(project.Tier),
		ClaimedAt: claimedAt,
	}, nil
}

func (h *Handler) GetProjectClaimStatus(ctx context.Context, params api.GetProjectClaimStatusParams) (api.GetProjectClaimStatusRes, error) {
	scopeCtx, _ := GetScopeContext(ctx)
	if _, err := h.requireBearerProject(ctx, string(params.ProjectID)); err != nil {
		return h.NewError(ctx, err), nil
	}
	status, err := h.projectService.GetClaimStatus(ctx, service.GetProjectClaimStatusInput{
		ProjectID:     string(params.ProjectID),
		ChallengeID:   params.ChallengeID,
		ProjectSecret: scopeCtx.ProjectSecret,
	})
	if err != nil {
		return h.NewError(ctx, err), nil
	}
	resp := &api.GetProjectClaimStatusOK{
		ProjectID:   api.ProjectID(status.ProjectID),
		ChallengeID: status.ChallengeID,
		Status:      api.GetProjectClaimStatusOKStatus(status.Status),
		ExpiresAt:   status.ExpiresAt,
	}
	if status.ClaimedAt != nil {
		resp.ClaimedAt = api.NewOptDateTime(*status.ClaimedAt)
	}
	if status.RotatedProjectSecret != "" {
		resp.RotatedProjectSecret = api.NewOptString(status.RotatedProjectSecret)
	}
	return resp, nil
}

func (h *Handler) requireBearerProject(ctx context.Context, projectID string) (ScopeContext, error) {
	scopeCtx, ok := GetScopeContext(ctx)
	if !ok || scopeCtx.ProjectID != projectID {
		return ScopeContext{}, domain.ErrAuthUnauthorized(nil)
	}
	return scopeCtx, nil
}

func getProjectResponse(project *domain.Project) *api.GetProjectResponse {
	resp := &api.GetProjectResponse{
		ProjectID:        api.ProjectID(project.ID),
		Lifecycle:        api.GetProjectResponseLifecycle(project.Lifecycle),
		PreviewOrigins:   project.PreviewOrigins,
		ClaimRequiredFor: getClaimRequiredFor(project),
		CreatedAt:        project.CreatedAt,
		UpdatedAt:        project.UpdatedAt,
	}
	if project.TeamID != "" {
		resp.TeamID = api.NewOptString(project.TeamID)
	}
	if project.Tier != "" {
		resp.Tier = api.NewOptGetProjectResponseTier(api.GetProjectResponseTier(project.Tier))
	}
	if project.ClaimedAt != nil {
		resp.ClaimedAt = api.NewOptDateTime(*project.ClaimedAt)
	}
	return resp
}

func createProjectLifecycle(lifecycle domain.ProjectLifecycle) api.CreateProjectResponseLifecycle {
	if lifecycle == domain.ProjectLifecycleClaimed {
		return api.CreateProjectResponseLifecycleClaimed
	}
	return api.CreateProjectResponseLifecycleUnclaimed
}

func createClaimRequiredFor(project *domain.Project) []api.CreateProjectResponseClaimRequiredForItem {
	if project.Lifecycle == domain.ProjectLifecycleClaimed {
		return []api.CreateProjectResponseClaimRequiredForItem{}
	}
	return []api.CreateProjectResponseClaimRequiredForItem{
		api.CreateProjectResponseClaimRequiredForItemPreview,
		api.CreateProjectResponseClaimRequiredForItemProduction,
	}
}

func getClaimRequiredFor(project *domain.Project) []api.GetProjectResponseClaimRequiredForItem {
	if project.Lifecycle == domain.ProjectLifecycleClaimed {
		return []api.GetProjectResponseClaimRequiredForItem{}
	}
	return []api.GetProjectResponseClaimRequiredForItem{
		api.GetProjectResponseClaimRequiredForItemPreview,
		api.GetProjectResponseClaimRequiredForItemProduction,
	}
}
