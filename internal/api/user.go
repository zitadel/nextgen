package api

import (
	"context"
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) CreateUser(ctx context.Context, req *api.User, params api.CreateUserParams) (api.CreateUserRes, error) {
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

func (h *Handler) GetUserByID(ctx context.Context, params api.GetUserByIDParams) (api.GetUserByIDRes, error) {
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
	creds, ok := sessionCredentialsFromContext(ctx)
	if !ok {
		return nil, domain.ErrSessionTokenInvalid()
	}
	input := service.GetMyUserInput{
		SessionToken: creds.raw,
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
	default:
		return internalErrorResponse(err)
	}
}
