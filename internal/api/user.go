package api

import (
	"context"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) CreateUser(ctx context.Context, req *api.User, params api.CreateUserParams) (api.CreateUserRes, error) {
	if !params.ProjectID.IsSet() {
		return nil, NoProjectError
	}
	var teamID *string
	if params.TeamID.IsSet() {
		teamID = new(string(params.TeamID.Value))
	}

	user := make(map[string]any)
	if err := convertUsingJson(req, &user); err != nil {
		return nil, err
	}

	u, err := h.userService.CreateUser(ctx, service.CreateUserInput{
		ProjectID: string(params.ProjectID.Value),
		TeamID:    teamID,
		User:      user,
	})
	if err != nil {
		return nil, err
	}

	resp := &api.CreateUserResponse{}
	if err := convertUsingJson(u, resp); err != nil {
		return nil, err
	}
	return resp, nil
}

// ------------------ Errors ---------------

func userErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	default:
		return internalErrorResponse(err)
	}
}
