package api

import (
	"context"
	"net/http"
	"strconv"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) CreateUser(ctx context.Context, req *api.User, params api.CreateUserParams) (api.CreateUserRes, error) {
	if err := requireProjectAccess(ctx, string(params.ProjectID), userAccess, opWrite); err != nil {
		return nil, err
	}
	var teamID *string
	if params.TeamID.IsSet() {
		teamID = new(string(params.TeamID.Value))
	}

	user, err := convertUsingJson[map[string]any](req)
	if err != nil {
		return nil, err
	}

	u, err := h.userService.CreateUser(ctx, service.CreateUserInput{
		ProjectID: string(params.ProjectID),
		TeamID:    teamID,
		User:      *user,
	})
	if err != nil {
		return nil, err
	}

	return convertUsingJson[api.CreateUserResponse](u)
}

// ListUsers scopes to the bearer's project: the operation carries no
// project parameter, so the oauth2 principal (the project secret the
// CLI's status probe sends) is the only authority. Spec defaults are
// applied here: limit 20 (max 100 enforced by decode), offset 0.
func (h *Handler) ListUsers(ctx context.Context, params api.ListUsersParams) (api.ListUsersRes, error) {
	scopeCtx, _ := GetScopeContext(ctx)
	// No project parameter: the operation is bound to the token's own project
	// by construction, so only the scope check is live — it keeps the
	// browser-plane preview secret from listing the project's users.
	if err := requireProjectAccess(ctx, scopeCtx.ProjectID, userAccess, opRead); err != nil {
		return nil, err
	}

	limit := uint32(20)
	if params.Limit.IsSet() {
		limit = uint32(params.Limit.Value)
	}
	var offset uint32
	if params.Offset.IsSet() && params.Offset.Value > 0 {
		offset = uint32(params.Offset.Value)
	}

	users, err := h.userService.ListUsers(ctx, service.ListUsersInput{
		ProjectID: scopeCtx.ProjectID,
		Offset:    offset,
		Limit:     limit,
	})
	if err != nil {
		return nil, err
	}

	res, err := convertUsingJson[api.ListUsersOKApplicationJSON](users)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (h *Handler) ListUserPassKeys(ctx context.Context, params api.ListUserPassKeysParams) (api.ListUserPassKeysRes, error) {
	if err := requireProjectAccess(ctx, string(params.ProjectID), userAccess, opRead); err != nil {
		return nil, err
	}

	passkeys, nextPage, err := h.userService.ListPasskeys(ctx, service.ListPasskeysInput{
		ProjectID: string(params.ProjectID),
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
			ID:        strconv.FormatInt(key.ID, 10),
			Name:      key.Name,
			CreatedAt: key.CreatedAt,
		}
	}

	return res, nil
}

func (h *Handler) GetUserByID(ctx context.Context, params api.GetUserByIDParams) (api.GetUserByIDRes, error) {
	if err := requireProjectAccess(ctx, string(params.ProjectID), userAccess, opRead); err != nil {
		return nil, err
	}
	var teamID *string
	if params.TeamID.IsSet() {
		teamID = new(string(params.TeamID.Value))
	}

	user, err := h.userService.GetUserByID(ctx, service.GetUserInput{
		ProjectID: string(params.ProjectID),
		TeamID:    teamID,
		UserID:    string(params.UserID),
	})
	if err != nil {
		return nil, err
	}

	return convertUsingJson[api.GetUserByIDOK](user)
}

func (h *Handler) SetUserPassword(ctx context.Context, req *api.SetUserPasswordRequest, params api.SetUserPasswordParams) (api.SetUserPasswordRes, error) {
	if err := requireProjectAccess(ctx, string(params.ProjectID), userAccess, opWrite); err != nil {
		return nil, err
	}
	err := h.userService.SetPassword(ctx, service.SetPasswordInput{
		ProjectID:                string(params.ProjectID),
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

	userbs, err := h.userService.GetMyUser(ctx, input)
	if err != nil {
		return nil, err
	}

	user := &api.GetMyUserOK{}
	err = user.UnmarshalJSON(userbs)
	if err != nil {
		return nil, err
	}
	return user, nil
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
