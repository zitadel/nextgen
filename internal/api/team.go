package api

import (
	"context"
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) CreateTeam(ctx context.Context, req *api.CreateTeamRequest, params api.CreateTeamParams) (r api.CreateTeamRes, _ error) {
	if err := requireProjectAccess(ctx, string(params.ProjectID), teamAccess, opWrite); err != nil {
		return nil, err
	}
	team, err := h.teamService.CreateTeam(ctx, service.CreateTeamInput{ProjectID: string(params.ProjectID)})
	if err != nil {
		return nil, err
	}
	return &api.CreateTeamResponse{
		ID:        team.ID,
		CreatedAt: team.CreatedAt,
	}, nil
}

func (h *Handler) GetTeam(ctx context.Context, params api.GetTeamParams) (api.GetTeamRes, error) {
	if err := requireProjectAccess(ctx, string(params.ProjectID), teamAccess, opRead); err != nil {
		return nil, err
	}
	team, err := h.teamService.GetTeam(ctx, string(params.ProjectID), string(params.TeamID))
	if err != nil {
		return nil, err
	}
	return &api.GetTeamResponse{
		ID:        team.ID,
		CreatedAt: team.CreatedAt,
		UpdatedAt: team.UpdatedAt,
	}, nil
}

// ------------------ Errors ---------------

func teamErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrTeamNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrTeamProjectNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrTeamPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	default:
		return internalErrorResponse(err)
	}
}
