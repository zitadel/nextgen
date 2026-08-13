package api

import (
	"context"
	"errors"
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) CreateTeam(ctx context.Context, req *api.CreateTeamRequest, params api.CreateTeamParams) (r api.CreateTeamRes, _ error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), teamAccess, opWrite); err != nil {
		return nil, err
	}
	team, err := h.teamService.Create(ctx, service.CreateTeamInput{
		ProjectID: string(params.ProjectID),
		Name:      req.Name,
	})
	if err != nil {
		return nil, err
	}
	return teamResponse(team), nil
}

func (h *Handler) GetTeam(ctx context.Context, params api.GetTeamParams) (api.GetTeamRes, error) {
	projectID, err := h.requireResourceAccess(ctx, string(params.TeamID), teamAccess, opRead)
	if err != nil {
		return nil, err
	}
	team, err := h.teamService.Get(ctx, projectID, string(params.TeamID))
	if err != nil {
		return nil, err
	}
	return teamResponse(team), nil
}

func (h *Handler) UpdateTeam(ctx context.Context, req *api.UpdateTeamRequest, params api.UpdateTeamParams) (api.UpdateTeamRes, error) {
	projectID, err := h.requireResourceAccess(ctx, string(params.TeamID), teamAccess, opWrite)
	if err != nil {
		return nil, err
	}
	input := service.UpdateTeamInput{
		ProjectID: projectID,
		TeamID:    string(params.TeamID),
	}
	if name, ok := req.Name.Get(); ok {
		input.Name = &name
	}
	team, err := h.teamService.Update(ctx, input)
	if err != nil {
		return nil, err
	}
	return teamResponse(team), nil
}

func (h *Handler) DeleteTeam(ctx context.Context, params api.DeleteTeamParams) (api.DeleteTeamRes, error) {
	projectID, err := h.requireTeamDelete(ctx, string(params.TeamID))
	if err != nil {
		if errors.Is(err, errResourceGone) {
			return &api.DeleteTeamNoContent{}, nil
		}
		return nil, err
	}
	if err := h.teamService.Delete(ctx, projectID, string(params.TeamID)); err != nil {
		return nil, err
	}
	return &api.DeleteTeamNoContent{}, nil
}

func (h *Handler) QueryTeams(ctx context.Context, req *api.QueryTeamsRequest, params api.QueryTeamsParams) (api.QueryTeamsRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), teamAccess, opRead); err != nil {
		return nil, err
	}
	ctx, err := h.withAuthzListFilter(ctx, string(params.ProjectID), domain.ResourceKindTeam, opRead)
	if err != nil {
		return nil, err
	}

	listed, err := h.teamService.List(ctx, mapQueryTeamsToService(string(params.ProjectID), req))
	if err != nil {
		return nil, err
	}

	teams := make([]api.TeamResponse, 0, len(listed.Teams))
	for _, team := range listed.Teams {
		teams = append(teams, *teamResponse(team))
	}
	resp := &api.QueryTeamsResponse{Teams: teams}
	if listed.NextPageToken != "" {
		resp.NextPageToken = api.NewOptNilPageToken(api.PageToken(listed.NextPageToken))
	}
	return resp, nil
}

// ------------------ Converters ---------------

func mapQueryTeamsToService(projectID string, req *api.QueryTeamsRequest) service.ListTeamsRequest {
	svcReq := service.ListTeamsRequest{
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

// teamResponse is the shared team body: createTeam, getTeam, updateTeam, and
// every item in queryTeams answer with it.
func teamResponse(team *domain.Team) *api.TeamResponse {
	return &api.TeamResponse{
		ID:        team.ID,
		Name:      team.Name,
		Status:    teamStatus(team.Status),
		CreatedAt: team.CreatedAt,
		UpdatedAt: team.UpdatedAt,
	}
}

func teamStatus(status domain.TeamStatus) api.TeamStatus {
	if status == domain.TeamStatusActive {
		return api.TeamStatusActive
	}
	// pending_purge is not part of the contract, such a team is no longer usable.
	return api.TeamStatusDeactivated
}

// ------------------ Errors ---------------

func teamErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrTeamNameInvalid().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrTeamNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrTeamProjectNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrTeamPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	case domain.ErrTeamAlreadyExists().Code:
		return errorResponseWithStatusCode(http.StatusConflict, err)
	default:
		return internalErrorResponse(err)
	}
}
