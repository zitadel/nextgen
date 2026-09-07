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
	update, err := patchProjectToService(projectID, req)
	if err != nil {
		return nil, err
	}
	project, err := h.projectService.Update(ctx, update)
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

// ------------------ Converters ---------------

// patchProjectToService reads a PATCH body as the set of fields it names. A
// field left out of the body is left out of the update; only what the caller
// wrote is carried through.
func patchProjectToService(projectID string, req *api.PatchProjectRequest) (service.UpdateProjectRequest, error) {
	update := service.UpdateProjectRequest{ID: projectID}
	// An absent or null name leaves nothing to write; a name that is present
	// but empty is rejected downstream with proj.name_invalid, the 400 the
	// contract declares.
	if name, ok := req.Name.Get(); ok {
		update.Name = &name
	}
	if req.PasswordHash.IsSet() {
		policy, err := passwordHashPolicyToDomain(req.PasswordHash)
		if err != nil {
			return service.UpdateProjectRequest{}, err
		}
		update.PasswordHashPolicy = &policy
	}
	return update, nil
}

// passwordHashPolicyToDomain converts a hashing method off the wire. Explicit
// null is the instruction to stop choosing one, and reaches the domain as a nil
// policy.
func passwordHashPolicyToDomain(field api.OptNilPasswordHashPolicy) (*domain.PasswordHashPolicy, error) {
	body, ok := field.Get()
	if !ok {
		return nil, nil
	}
	params := make(map[string]any, 6)
	if v, ok := body.Params.Time.Get(); ok {
		params["time"] = v
	}
	if v, ok := body.Params.Memory.Get(); ok {
		params["memory"] = v
	}
	if v, ok := body.Params.Threads.Get(); ok {
		params["threads"] = v
	}
	if v, ok := body.Params.Cost.Get(); ok {
		params["cost"] = v
	}
	if v, ok := body.Params.Rounds.Get(); ok {
		params["rounds"] = v
	}
	if v, ok := body.Params.Hash.Get(); ok {
		params["hash"] = string(v)
	}
	// The domain owns which parameters an algorithm takes, so the wire type
	// carries every parameter as optional and the exact set is checked there.
	return domain.NewPasswordHashPolicy(string(body.Algorithm), params)
}

// passwordHashPolicyResponse answers with the project's own hashing method, or
// null where it uses the deployment default -- the same shape a PATCH sends, so
// what a caller reads back is what they could write.
func passwordHashPolicyResponse(policy *domain.PasswordHashPolicy) api.OptNilPasswordHashPolicy {
	if policy == nil {
		var absent api.OptNilPasswordHashPolicy
		absent.SetToNull()
		return absent
	}
	body := api.PasswordHashPolicy{Algorithm: api.PasswordHashPolicyAlgorithm(policy.Algorithm)}
	number := func(name string) api.OptInt {
		value, ok := passwordHashParamInt(policy.Params[name])
		if !ok {
			return api.OptInt{}
		}
		return api.NewOptInt(value)
	}
	body.Params.Time = number("time")
	body.Params.Memory = number("memory")
	body.Params.Threads = number("threads")
	body.Params.Cost = number("cost")
	body.Params.Rounds = number("rounds")
	if mode, ok := policy.Params["hash"].(string); ok {
		body.Params.Hash = api.NewOptPasswordHashPolicyParamsHash(api.PasswordHashPolicyParamsHash(mode))
	}
	return api.NewOptNilPasswordHashPolicy(body)
}

// passwordHashParamInt reads a stored parameter as a number. A policy that came
// back through storage carries JSON numbers (float64); one still in hand from
// the request carries ints.
func passwordHashParamInt(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, true
	case int64:
		return int(typed), true
	case float64:
		return int(typed), true
	default:
		return 0, false
	}
}

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
		PasswordHash:   passwordHashPolicyResponse(project.PasswordHashPolicy),
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
	case domain.ErrProjectNameInvalid().Code, domain.ErrProjectMissingID().Code,
		domain.ErrProjectPasswordHashInvalid().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrProjectAlreadyClaimed().Code:
		return errorResponseWithStatusCode(http.StatusConflict, err)
	case domain.ErrProjectClaimExpired().Code:
		return errorResponseWithStatusCode(http.StatusGone, err)
	default:
		return internalErrorResponse(err)
	}
}
