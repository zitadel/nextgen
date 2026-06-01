package api

import (
	"context"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) SetUserPassword(ctx context.Context, req *api.SetUserPasswordRequest, params api.SetUserPasswordParams) (api.SetUserPasswordRes, error) {
	var teamID *string
	if params.TeamID.IsSet() {
		teamID = new(string(params.TeamID.Value))
	}

	err := h.userService.SetPassword(ctx, service.SetPasswordInput{
		ProjectID: string(params.ProjectID),
		TeamID:    teamID,
		UserID:    string(params.UserID),
		Password:  req.Password,
	})
	if err != nil {
		return nil, err
	}

	return &api.SetUserPasswordNoContent{}, nil
}
