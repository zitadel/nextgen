package api

import (
	"context"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/service"
)

// ListProjectAdmins is the members list cut to admins; it goes once the
// console reads the members list.
func (h *Handler) ListProjectAdmins(ctx context.Context, params api.ListProjectAdminsParams) (api.ListProjectAdminsRes, error) {
	projectID := string(params.ProjectID)
	if err := h.requireProjectAccess(ctx, projectID, projectAccess, opRead); err != nil {
		return nil, err
	}
	listed, err := h.grantService.ListProjectMembers(ctx, service.ListProjectMembersInput{
		ProjectID:   projectID,
		MinRelation: "admin",
		PageToken:   string(params.PageToken.Value),
		Limit:       int(params.Limit.Value),
	})
	if err != nil {
		return nil, err
	}
	res := &api.ListProjectAdminsResponse{Admins: make([]api.ProjectAdmin, 0, len(listed.Members))}
	if listed.NextPageToken != "" {
		res.NextPageToken = api.NewOptNilPageToken(api.PageToken(listed.NextPageToken))
	}
	for _, admin := range listed.Members {
		res.Admins = append(res.Admins, projectAdminResponse(admin))
	}
	return res, nil
}

func projectAdminResponse(admin *service.ProjectMember) api.ProjectAdmin {
	sources := make([]api.ProjectAdminSource, 0, len(admin.Sources))
	for _, source := range admin.Sources {
		if source.OwningTeam {
			sources = append(sources, api.NewProjectAdminOwningTeamSourceProjectAdminSource(api.ProjectAdminOwningTeamSource{
				Type: api.ProjectAdminOwningTeamSourceTypeOwningTeam,
				Team: projectMemberTeamRef(source.TeamID, source.TeamName),
			}))
			continue
		}
		grant := api.ProjectAdminGrantSource{Type: api.ProjectAdminGrantSourceTypeGrant, GrantID: source.GrantID}
		if source.TeamID != "" {
			grant.Team = api.NewOptTeamRef(projectMemberTeamRef(source.TeamID, source.TeamName))
		}
		sources = append(sources, api.NewProjectAdminGrantSourceProjectAdminSource(grant))
	}
	return api.ProjectAdmin{User: userRefToAPI(admin.User), Sources: sources}
}
