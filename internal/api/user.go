package api

import (
	"context"
	"encoding/json"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) CreateUser(ctx context.Context, req api.User, params api.CreateUserParams) (r api.CreateUserRes, _ error) {
	user := make(map[string]any, len(req))
	err := convertUserToJson(req, &user)
	if err != nil {
		return nil, err
	}

	i := service.CreateUserInput{
		ProjectID: string(params.ProjectID.Value),
		User:      user,
	}
	if params.TeamID.Set {
		i.TeamID = new(string(params.TeamID.Value))
	}

	u, err := h.userService.CreateUser(ctx, i)
	if err != nil {
		return nil, err
	}

	resp := &api.CreateUserResponse{}
	err = convertUserToJson(u, resp)
	if err != nil {
		return nil, err
	}
	return resp, nil
}

func (h *Handler) UpdateUser(ctx context.Context, req api.User, params api.UpdateUserParams) (r api.UpdateUserRes, _ error) {
	user := make(map[string]any, len(req))
	err := convertUserToJson(req, &user)
	if err != nil {
		return nil, err
	}

	i := service.UpdateUserInput{
		ProjectID: string(params.ProjectID.Value),
		UserID:    string(params.UserID),
		User:      user,
	}
	if params.TeamID.Set {
		i.TeamID = new(string(params.TeamID.Value))
	}

	u, err := h.userService.UpdateUser(ctx, i)
	if err != nil {
		return nil, err
	}

	resp := &api.UpdateUserOK{}
	err = convertUserToJson(u, resp)
	if err != nil {
		return nil, err
	}
	return resp, nil
}

func (h *Handler) GetUser(ctx context.Context, params api.GetUserParams) (r api.GetUserRes, _ error) {
	panic("Implement me")
}

func (h *Handler) ListUsers(ctx context.Context, params api.ListUsersParams) (r api.ListUsersRes, _ error) {
	panic("Implement me")
}

// ---- Converters -------------------------------------------------------------

func convertUserToJson(source any, target any) error {
	// unmarshalling and unmarshalling is not performant, but I don't want to write a custom converter using reflection.
	// as long https://github.com/ogen-go/ogen/issues/1313 is open, I don't see another way.
	bs, err := json.Marshal(source)
	if err != nil {
		return err
	}
	return json.Unmarshal(bs, target)
}
