package api

import (
	"context"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) ListProjectAdmins(ctx context.Context, params api.ListProjectAdminsParams) (api.ListProjectAdminsRes, error) {
	projectID := string(params.ProjectID)
	if err := h.requireProjectAccess(ctx, projectID, projectAccess, opRead); err != nil {
		return nil, err
	}
	var viewerUserID string
	if scope, ok := GetScopeContext(ctx); ok && scope.PrincipalType == domain.AuthzPrincipalTypeUser {
		viewerUserID = scope.PrincipalID
	}
	listed, err := h.grantService.ListProjectAdmins(ctx, service.ListProjectAdminsInput{
		ProjectID:    projectID,
		ViewerUserID: viewerUserID,
		PageToken:    string(params.PageToken.Value),
		Limit:        int(params.Limit.Value),
	})
	if err != nil {
		return nil, err
	}
	res := &api.ListProjectAdminsResponse{Admins: make([]api.ProjectAdmin, 0, len(listed.Admins))}
	if listed.NextPageToken != "" {
		res.NextPageToken = api.NewOptNilPageToken(api.PageToken(listed.NextPageToken))
	}
	for _, admin := range listed.Admins {
		res.Admins = append(res.Admins, projectAdminResponse(admin))
	}
	return res, nil
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
