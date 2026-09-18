package api

import (
	"context"
	"errors"
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func (h *Handler) CreateProject(ctx context.Context, req *api.CreateProjectRequest) (api.CreateProjectRes, error) {
	project, err := h.projectService.Create(ctx, req.Name, req.PreviewOrigins, req.SeedDefaults.Or(true))
	if err != nil {
		return nil, err
	}
	// POST /projects is unauthenticated; Path A needs the new project_id on
	// the actor slot so request.api is tenant-scoped after create.
	audit.BindPublicRequest(ctx, project.ID, "", "")

	projectSecret, err := h.tokenService.GenerateJWE(ctx, project.Token())
	if err != nil {
		return nil, err
	}
	previewSecret, err := h.tokenService.GenerateJWE(ctx, project.PreviewToken())
	if err != nil {
		return nil, err
	}

	return &api.CreateProjectResponse{
		ID:             project.ID,
		Name:           project.Name,
		ProjectSecret:  projectSecret,
		PreviewSecret:  previewSecret,
		PreviewOrigins: project.PreviewOrigins,
		CreatedAt:      project.CreatedAt,
	}, nil
}

func (h *Handler) GetProject(ctx context.Context, params api.GetProjectParams) (api.GetProjectRes, error) {
	projectID := string(params.ProjectID)
	if err := h.requireProjectAccess(ctx, projectID, projectAccess, opRead); err != nil {
		return nil, err
	}
	project, err := h.projectService.Get(ctx, projectID)
	if err != nil {
		// The guard already bound the request to the token's own project, so
		// this only fires if that project vanished mid-request; answer with
		// the same proj.not_found the guard uses so the two are inseparable.
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrProjectNotFound()
		}
		return nil, err
	}
	return projectResponse(project), nil
}

func (h *Handler) PatchProject(ctx context.Context, req *api.PatchProjectRequest, params api.PatchProjectParams) (api.PatchProjectRes, error) {
	projectID := string(params.ProjectID)
	if err := h.requireProjectAccess(ctx, projectID, projectAccess, opWrite); err != nil {
		return nil, err
	}
	patch := service.ProjectPatch{}
	if name, ok := req.Name.Get(); ok {
		patch.Name = &name
	}
	// Present means replace, absent means keep: an empty list is a real
	// value here (allow every origin), so nil and [] must stay distinct.
	if req.PreviewOrigins != nil {
		origins := req.PreviewOrigins
		patch.PreviewOrigins = &origins
	}
	project, err := h.projectService.Update(ctx, projectID, patch)
	if err != nil {
		return nil, err
	}
	return projectResponse(project), nil
}

// QueryProjects has no project parameter: results are restricted to the
// caller's project. The authz gate rejects an unbound / no-foothold scope, so the
// ProjectID passed on is always set.
func (h *Handler) QueryProjects(ctx context.Context, req *api.QueryProjectsRequest) (api.QueryProjectsRes, error) {
	scopeCtx, _ := GetScopeContext(ctx)
	if err := h.requireProjectAccess(ctx, scopeCtx.ProjectID, projectAccess, opRead); err != nil {
		return nil, err
	}

	listed, err := h.projectService.List(ctx, mapQueryProjectsToService(scopeCtx.ProjectID, req))
	if err != nil {
		return nil, err
	}

	projects := make([]api.ProjectResponse, 0, len(listed.Projects))
	for _, project := range listed.Projects {
		projects = append(projects, *projectResponse(project))
	}
	resp := &api.QueryProjectsResponse{Projects: projects}
	if listed.NextPageToken != "" {
		resp.NextPageToken = api.NewOptNilPageToken(api.PageToken(listed.NextPageToken))
	}
	return resp, nil
}

// ListMyProjects answers "which projects can the person behind this session act
// on". There is no requireProjectAccess here on purpose: the query is itself the
// authorization, so a caller with no grants gets an empty page rather than a 403.
func (h *Handler) ListMyProjects(ctx context.Context, params api.ListMyProjectsParams) (api.ListMyProjectsRes, error) {
	token, ok := sessionTokenFromContext(ctx)
	if !ok || token.UserID == "" {
		return nil, invalidSessionCredential(domain.ErrSessionTokenInvalid())
	}

	listed, err := h.projectService.ListAuthorized(ctx, service.ListAuthorizedProjectsRequest{
		HomeProjectID: token.ProjectID,
		UserID:        token.UserID,
		Limit:         int(params.Limit.Value),
		PageToken:     string(params.PageToken.Value),
	})
	if err != nil {
		// A refused session answers exactly like an anonymous one. Letting
		// sess.token_invalid through here would tell a caller that its cookie is
		// genuine and the user behind it is deactivated (#553).
		if errors.Is(err, domain.ErrSessionTokenInvalid()) {
			return nil, invalidSessionCredential(err)
		}
		return nil, err
	}

	projects := make([]api.ProjectResponse, 0, len(listed.Projects))
	for _, project := range listed.Projects {
		projects = append(projects, *projectResponse(project))
	}
	resp := api.ListMyProjectsResponse{Projects: projects}
	if listed.NextPageToken != "" {
		resp.NextPageToken = api.NewOptNilPageToken(api.PageToken(listed.NextPageToken))
	}
	return &api.ListMyProjectsResponseHeaders{
		CacheControl: api.NewOptString(sessionStateCacheControl),
		Response:     resp,
	}, nil
}

// ------------------ Converters ---------------

func mapQueryProjectsToService(projectID string, req *api.QueryProjectsRequest) service.ListProjectsRequest {
	svcReq := service.ListProjectsRequest{
		ProjectID: projectID,
		Limit:     int(req.Limit.Or(0)), // if not defined, set to default value in the service layer
		PageToken: string(req.PageToken.Or("")),
	}
	if sorting, ok := req.Sorting.Get(); ok {
		svcReq.Sorting = sortingToService(sorting.Field, sorting.Direction)
	}
	for _, filter := range req.Filter {
		svcReq.Filters = append(svcReq.Filters, filterToService(filter.Field, filter.Operation, filter.Value))
	}
	return svcReq
}

// projectResponse is the shared project body: getProject, patchProject, and
// every item in queryProjects answer with it.
func projectResponse(project *domain.Project) *api.ProjectResponse {
	return &api.ProjectResponse{
		ID:             project.ID,
		Name:           project.Name,
		PreviewOrigins: project.PreviewOrigins,
		CreatedAt:      project.CreatedAt,
		UpdatedAt:      project.UpdatedAt,
	}
}

// ------------------ Errors ---------------

func projectErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrProjectNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrProjectPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	case domain.ErrProjectNameInvalid().Code, domain.ErrProjectMissingID().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrProjectAlreadyClaimed().Code:
		return errorResponseWithStatusCode(http.StatusConflict, err)
	case domain.ErrProjectClaimExpired().Code:
		return errorResponseWithStatusCode(http.StatusGone, err)
	case domain.ErrProjectClaimWindowExpired().Code:
		// Gone like an expired challenge, but under its own code: a new
		// challenge fixes claim_expired, nothing fixes a closed window.
		return errorResponseWithStatusCode(http.StatusGone, err)
	default:
		return internalErrorResponse(err)
	}
}
