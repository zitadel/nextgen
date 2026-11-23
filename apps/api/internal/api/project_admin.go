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
	return api.ProjectAdmin{
		User: userRefToAPI(admin.User),
		Sources: mapProjectMemberSources(admin.Sources,
			func(team api.TeamRef) api.ProjectAdminSource {
				return api.NewProjectAdminOwningTeamSourceProjectAdminSource(api.ProjectAdminOwningTeamSource{
					Type: api.ProjectAdminOwningTeamSourceTypeOwningTeam,
					Team: team,
				})
			},
			func(grantID string, team api.OptTeamRef) api.ProjectAdminSource {
				return api.NewProjectAdminGrantSourceProjectAdminSource(api.ProjectAdminGrantSource{
					Type:    api.ProjectAdminGrantSourceTypeGrant,
					GrantID: grantID,
					Team:    team,
				})
			},
		),
	}
}
