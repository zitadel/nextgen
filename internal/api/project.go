package api

import (
	"context"
	"errors"
	"net/http"
	"strings"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func (h *Handler) CreateProject(ctx context.Context, req *api.CreateProjectRequest) (api.CreateProjectRes, error) {
	project, err := h.projectService.Create(ctx, req.Name, allowedOriginsToDomain(req.AllowedOrigins), req.SeedDefaults.Or(true))
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
	previewToken, err := h.tokenService.GenerateJWE(ctx, project.PreviewDeployToken())
	if err != nil {
		return nil, err
	}

	return &api.CreateProjectResponse{
		ID:             project.ID,
		Name:           project.Name,
		Class:          api.ProjectClass(project.Class.String()),
		ProjectSecret:  projectSecret,
		PreviewSecret:  previewSecret,
		PreviewToken:   previewToken,
		AllowedOrigins: allowedOriginsToAPI(project.AllowedOrigins),
		CreatedAt:      project.CreatedAt,
	}, nil
}

func (h *Handler) AddAllowedOrigin(ctx context.Context, req *api.AllowedOrigin, params api.AddAllowedOriginParams) (api.AddAllowedOriginRes, error) {
	projectID := string(params.ProjectID)
	if err := h.requireProjectAccess(ctx, projectID, projectAccess, opWrite); err != nil {
		return nil, err
	}
	if !hasGranularOrOperator(ctx, "allowed_origin.write") {
		return nil, domain.ErrOriginPermissionDenied()
	}
	kind, err := domain.OriginKindString(string(req.Kind))
	if err != nil {
		return nil, domain.ErrOriginInvalid(map[string]string{"pattern": req.Pattern, "reason": "unknown kind"})
	}
	warning, err := h.projectService.AddAllowedOrigin(ctx, projectID, domain.AllowedOrigin{Pattern: req.Pattern, Kind: kind})
	if err != nil {
		return nil, err
	}
	resp := api.AddAllowedOriginResponse{
		Pattern: strings.ToLower(strings.TrimSpace(req.Pattern)),
		Kind:    api.AddAllowedOriginResponseKind(kind.String()),
		Check: api.AddAllowedOriginResponseCheck{
			Status:  api.AddAllowedOriginResponseCheckStatusOk,
			Message: "the pattern passed every check for the project's class",
		},
	}
	if warning != nil {
		resp.Check = api.AddAllowedOriginResponseCheck{
			Status:  api.AddAllowedOriginResponseCheckStatusWarning,
			Code:    api.NewOptString(warning.Code),
			Message: warning.Message,
		}
	}
	return &resp, nil
}

func (h *Handler) RemoveAllowedOrigin(ctx context.Context, req *api.RemoveAllowedOriginReq, params api.RemoveAllowedOriginParams) (api.RemoveAllowedOriginRes, error) {
	projectID := string(params.ProjectID)
	if err := h.requireProjectAccess(ctx, projectID, projectAccess, opWrite); err != nil {
		return nil, err
	}
	if !hasGranularOrOperator(ctx, "allowed_origin.delete") {
		return nil, domain.ErrOriginPermissionDenied()
	}
	if err := h.projectService.RemoveAllowedOrigin(ctx, projectID, req.Pattern); err != nil {
		return nil, err
	}
	return &api.RemoveAllowedOriginNoContent{}, nil
}

func (h *Handler) SetProjectClass(ctx context.Context, req *api.SetProjectClassReq, params api.SetProjectClassParams) (api.SetProjectClassRes, error) {
	projectID := string(params.ProjectID)
	if err := h.requireProjectAccess(ctx, projectID, projectAccess, opWrite); err != nil {
		return nil, err
	}
	if !hasOperatorProjectWrite(scopeOf(ctx)) {
		return nil, domain.ErrProjectPermissionDenied()
	}
	class, err := domain.ProjectClassString(string(req.Class))
	if err != nil {
		return nil, domain.ErrProjectClassChangeRefused(map[string]string{"reason": "unknown class"})
	}
	project, err := h.projectService.SetClass(ctx, projectID, class, req.Confirm.Or(false))
	if err != nil {
		return nil, err
	}
	return projectResponse(project), nil
}

// scopeOf is the caller's minted scopes, empty without a credential.
func scopeOf(ctx context.Context) []string {
	sc, ok := GetScopeContext(ctx)
	if !ok {
		return nil
	}
	return sc.Scope
}

func (h *Handler) GetProject(ctx context.Context, params api.GetProjectParams) (api.GetProjectRes, error) {
	projectID := string(params.ProjectID)
	if err := h.requireProjectAccess(ctx, projectID, projectAccess, opRead); err != nil {
		return nil, err
	}
	project, err := h.projectService.Get(ctx, projectID)
	if err != nil {
		// The guard already found the project for this caller (its own project
		// for a secret, a granted one for a session), so this only fires if the
		// project vanished mid-request; answer with the same proj.not_found the
		// guard uses so the two are inseparable.
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

	update := service.UpdateProjectRequest{ID: projectID}
	if name, ok := req.Name.Get(); ok {
		update.Name = &name
	}
	if req.PasswordHash.IsSet() {
		policy, err := passwordHashPolicyToDomain(req.PasswordHash)
		if err != nil {
			return nil, err
		}
		update.PasswordHashPolicy = &policy
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
		Class:          api.ProjectClass(project.Class.String()),
		AllowedOrigins: allowedOriginsToAPI(project.AllowedOrigins),
		PasswordHash:   passwordHashPolicyResponse(project.PasswordHashPolicy),
		CreatedAt:      project.CreatedAt,
		UpdatedAt:      project.UpdatedAt,
	}
}

func allowedOriginsToAPI(origins []domain.AllowedOrigin) []api.AllowedOrigin {
	out := make([]api.AllowedOrigin, len(origins))
	for i, entry := range origins {
		out[i] = api.AllowedOrigin{Pattern: entry.Pattern, Kind: api.AllowedOriginKind(entry.Kind.String())}
	}
	return out
}

// allowedOriginsToDomain carries the wire entries over unchecked: the kind
// enum is closed by the decoder and the pattern is normalised by the domain.
func allowedOriginsToDomain(origins []api.AllowedOrigin) []domain.AllowedOrigin {
	out := make([]domain.AllowedOrigin, 0, len(origins))
	for _, entry := range origins {
		kind, err := domain.OriginKindString(string(entry.Kind))
		if err != nil {
			kind = domain.OriginKindPrimary
		}
		out = append(out, domain.AllowedOrigin{Pattern: entry.Pattern, Kind: kind})
	}
	return out
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
	case domain.ErrProjectOriginNotAllowed(nil).Code,
		domain.ErrProjectPreviewNotLive(nil).Code,
		domain.ErrProjectMismatch().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	case domain.ErrProjectClassChangeRefused(nil).Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
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
