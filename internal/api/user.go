package api

import (
	"context"
	"errors"
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) CreateUser(ctx context.Context, req *api.CreateUserRequest, params api.CreateUserParams) (api.CreateUserRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), userAccess, opWrite); err != nil {
		return nil, err
	}
	var teamID *string
	if params.TeamID.IsSet() {
		teamID = new(string(params.TeamID.Value))
	}

	attributes, err := convertUsingJson[map[string]any](req.Attributes)
	if err != nil {
		return nil, err
	}

	user, err := h.userService.CreateUser(ctx, service.CreateUserInput{
		ProjectID:  string(params.ProjectID),
		TeamID:     teamID,
		SchemaURL:  req.Schema,
		Attributes: *attributes,
	})
	if err != nil {
		return nil, err
	}

	return domainUserToApiUser(user)
}

func (h *Handler) DeleteUserByID(ctx context.Context, params api.DeleteUserByIDParams) (api.DeleteUserByIDRes, error) {
	projectID, err := h.requireResourceAccess(ctx, string(params.UserID), userAccess, opDelete)
	if err != nil {
		if errors.Is(err, errResourceGone) {
			return &api.DeleteUserByIDNoContent{}, nil
		}
		return nil, err
	}

	err = h.userService.DeleteUser(ctx, service.DeleteUserInput{
		ProjectID: projectID,
		UserID:    string(params.UserID),
	})
	if err != nil {
		return nil, err
	}

	return &api.DeleteUserByIDNoContent{}, nil
}

// QueryUsers is the users list (ADR 031). It carries no project parameter: the
// oauth2 principal (the project secret the CLI's status probe sends) is the
// only authority for which project's users are served, so the scope check is
// what keeps a browser-plane preview secret out. Results are newest-first
// unless the request sorts otherwise.
func (h *Handler) QueryUsers(ctx context.Context, req *api.QueryUsersRequest) (api.QueryUsersRes, error) {
	scopeCtx, _ := GetScopeContext(ctx)
	ctx, err := h.requireProjectListAccess(ctx, scopeCtx.ProjectID, userAccess, domain.ResourceKindUser)
	if err != nil {
		return nil, err
	}

	users, err := h.userService.ListUsers(ctx, mapQueryUsersToService(scopeCtx.ProjectID, req))
	if err != nil {
		return nil, err
	}

	resp := &api.QueryUsersResponse{
		Users: make([]api.User, 0, len(users.Items)),
	}
	if users.NextPageToken != "" {
		resp.NextPageToken = api.NewOptNilPageToken(api.PageToken(users.NextPageToken))
	}
	for _, user := range users.Items {
		u, err := domainUserToApiUser(user)
		if err != nil {
			return nil, err
		}
		resp.Users = append(resp.Users, *u)
	}

	return resp, nil
}

func mapQueryUsersToService(projectID string, req *api.QueryUsersRequest) service.ListUsersInput {
	input := service.ListUsersInput{
		ProjectID: projectID,
		// The decoder fills this with the schema's default (20) when the body
		// omits it, and the schema floors it at 1; the service still normalizes,
		// which is what bounds callers that reach it without going through HTTP.
		Limit:     int(req.Limit.Or(0)),
		PageToken: string(req.PageToken.Or("")),
	}
	if sorting, ok := req.Sorting.Get(); ok {
		input.Sorting = sortingToService(sorting.Field, sorting.Direction)
	}
	for _, filter := range req.Filter {
		input.Filters = append(input.Filters, filterToService(filter.Field, filter.Operation, filter.Value))
	}
	return input
}

func (h *Handler) ListUserPasskeys(ctx context.Context, params api.ListUserPasskeysParams) (api.ListUserPasskeysRes, error) {
	projectID, err := h.requireResourceAccess(ctx, string(params.UserID), userAccess, opRead)
	if err != nil {
		return nil, err
	}

	passkeys, nextPage, err := h.userService.ListPasskeys(ctx, service.ListPasskeysInput{
		ProjectID: projectID,
		UserID:    string(params.UserID),
		PageToken: string(params.PageToken.Value),
		Limit:     int(params.Limit.Value),
	})
	if err != nil {
		return nil, err
	}

	res := &api.ListUserPasskeysResponse{
		Passkeys: make([]api.ListUserPasskeysResponsePasskeysItem, len(passkeys), len(passkeys)),
	}
	if nextPage != "" {
		res.NextPageToken = api.NewOptNilPageToken(api.PageToken(nextPage))
	}

	for i, key := range passkeys {
		res.Passkeys[i] = api.ListUserPasskeysResponsePasskeysItem{
			ID:        key.ID,
			Name:      key.Name,
			CreatedAt: key.CreatedAt,
		}
	}

	return res, nil
}

// ListUserTeams serves the user's team roster — the N:N membership list, one
// page at a time, each entry carrying the team's name so a client renders the
// page without resolving ids one by one. Lifecycle ownership is a different
// question and stays on the user itself (ADR 024).
func (h *Handler) ListUserTeams(ctx context.Context, params api.ListUserTeamsParams) (api.ListUserTeamsRes, error) {
	projectID, err := h.requireResourceAccess(ctx, string(params.UserID), userAccess, opRead)
	if err != nil {
		return nil, err
	}

	teams, err := h.userService.ListUserTeams(ctx, service.ListUserTeamsInput{
		ProjectID: projectID,
		UserID:    string(params.UserID),
		PageToken: string(params.PageToken.Value),
		Limit:     int(params.Limit.Value),
	})
	if err != nil {
		return nil, err
	}

	res := &api.ListUserTeamsResponse{
		Teams: make([]api.UserTeam, 0, len(teams.Items)),
	}
	if teams.NextPageToken != "" {
		res.NextPageToken = api.NewOptNilPageToken(api.PageToken(teams.NextPageToken))
	}
	for _, team := range teams.Items {
		res.Teams = append(res.Teams, api.UserTeam{
			ID:               team.TeamID,
			Name:             team.TeamName,
			MembershipStatus: api.UserTeamMembershipStatus(team.Status),
			CreatedAt:        team.CreatedAt,
			UpdatedAt:        team.UpdatedAt,
		})
	}

	return res, nil
}

func (h *Handler) GetUserByID(ctx context.Context, params api.GetUserByIDParams) (api.GetUserByIDRes, error) {
	projectID, err := h.requireResourceAccess(ctx, string(params.UserID), userAccess, opRead)
	if err != nil {
		return nil, err
	}
	var teamID *string
	if params.TeamID.IsSet() {
		teamID = new(string(params.TeamID.Value))
	}

	user, err := h.userService.GetUserByID(ctx, service.GetUserInput{
		ProjectID: projectID,
		TeamID:    teamID,
		UserID:    string(params.UserID),
	})
	if err != nil {
		return nil, err
	}

	return domainUserToApiUser(user)
}

func (h *Handler) SetUserPassword(ctx context.Context, req *api.SetUserPasswordRequest, params api.SetUserPasswordParams) (api.SetUserPasswordRes, error) {
	projectID, err := h.requireResourceAccess(ctx, string(params.UserID), userAccess, opWrite)
	if err != nil {
		return nil, err
	}
	err = h.userService.SetPassword(ctx, service.SetPasswordInput{
		ProjectID:                projectID,
		UserID:                   string(params.UserID),
		Password:                 req.Password,
		IsPasswordChangeRequired: req.IsChangeRequired.Value,
	})
	if err != nil {
		return nil, err
	}

	return &api.SetUserPasswordNoContent{}, nil
}

func (h *Handler) GetMyUser(ctx context.Context) (api.GetMyUserRes, error) {
	sessionToken, ok := sessionTokenFromContext(ctx)
	if !ok {
		return nil, domain.ErrSessionTokenInvalid()
	}
	input := service.GetMyUserInput{
		SessionToken: sessionToken,
	}

	user, err := h.userService.GetMyUser(ctx, input)
	if err != nil {
		return nil, err
	}

	return domainUserToApiUser(user)
}

// ------------------ Mappers ---------------

func domainUserToApiUser(user *domain.User) (*api.User, error) {
	userData, err := user.Attributes.ToMap()
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to parse user attributes")
	}

	attributes, err := convertUsingJson[api.UserAttributes](userData)
	if err != nil {
		return nil, err
	}

	var lifecycleOwnerTeamID api.OptNilString
	if teamID, ok := user.OwningTeamID(); ok {
		lifecycleOwnerTeamID.SetTo(teamID)
	} else {
		lifecycleOwnerTeamID.SetToNull()
	}

	return &api.User{
		ID:         api.UserID(user.ID),
		Schema:     user.SchemaURL,
		Attributes: *attributes,
		Metadata: api.UserMetadata{
			CreatedAt:            user.Metadata.CreatedAt,
			UpdatedAt:            user.Metadata.UpdatedAt,
			Status:               api.UserMetadataStatus(user.Metadata.Status),
			LifecycleOwnerTeamID: lifecycleOwnerTeamID,
		},
	}, nil
}

// ------------------ Errors ---------------

func userErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrUserInvalid().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrUserNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrUserAlreadyExists().Code:
		return errorResponseWithStatusCode(http.StatusConflict, err)
	case domain.ErrUserPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	default:
		return internalErrorResponse(err)
	}
}
