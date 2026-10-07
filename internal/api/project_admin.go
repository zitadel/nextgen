package api

import (
	"context"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) ListProjectAdmins(ctx context.Context, params api.ListProjectAdminsParams) (api.ListProjectAdminsRes, error) {
	projectID := string(params.ProjectID)
	if err := h.requireProjectAccess(ctx, projectID, projectAccess, opRead); err != nil {
		return nil, err
	}
	listed, err := h.grantService.ListProjectAdmins(ctx, projectID)
	if err != nil {
		return nil, err
	}
	admins := make([]api.ProjectAdmin, 0, len(listed.Admins))
	for _, admin := range listed.Admins {
		admins = append(admins, projectAdminResponse(admin))
	}
	return &api.ListProjectAdminsResponse{Admins: admins, Truncated: listed.Truncated}, nil
}

func projectAdminResponse(admin *service.ProjectAdmin) api.ProjectAdmin {
	sources := make([]api.ProjectAdminSource, 0, len(admin.Sources))
	for _, source := range admin.Sources {
		out := api.ProjectAdminSource{Type: api.ProjectAdminSourceType(source.Type)}
		if source.GrantID != "" {
			out.GrantID = api.NewOptString(source.GrantID)
		}
		if source.Team != nil {
			team := api.TeamRef{TeamID: source.Team.TeamID}
			if source.Team.Name != "" {
				team.Name = api.NewOptString(source.Team.Name)
			}
			out.Team = api.NewOptTeamRef(team)
		}
		sources = append(sources, out)
	}
	return api.ProjectAdmin{User: userRefToAPI(admin.User), Sources: sources}
}
