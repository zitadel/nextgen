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
		if source.Type == service.ProjectAdminSourceOwningTeam {
			sources = append(sources, api.NewProjectAdminOwningTeamSourceProjectAdminSource(api.ProjectAdminOwningTeamSource{
				Type: api.ProjectAdminOwningTeamSourceTypeOwningTeam,
				Team: projectAdminTeamRef(source.Team),
			}))
			continue
		}
		grant := api.ProjectAdminGrantSource{Type: api.ProjectAdminGrantSourceTypeGrant, GrantID: source.GrantID}
		if source.Team != nil {
			grant.Team = api.NewOptTeamRef(projectAdminTeamRef(source.Team))
		}
		sources = append(sources, api.NewProjectAdminGrantSourceProjectAdminSource(grant))
	}
	return api.ProjectAdmin{User: userRefToAPI(admin.User), Sources: sources}
}

func projectAdminTeamRef(team *service.TeamRef) api.TeamRef {
	if team == nil {
		return api.TeamRef{}
	}
	out := api.TeamRef{TeamID: team.TeamID}
	if team.Name != "" {
		out.Name = api.NewOptString(team.Name)
	}
	return out
}
