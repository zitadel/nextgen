package api

import (
	"context"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) ListProjectMembers(ctx context.Context, params api.ListProjectMembersParams) (api.ListProjectMembersRes, error) {
	projectID := string(params.ProjectID)
	if err := h.requireProjectAccess(ctx, projectID, projectAccess, opRead); err != nil {
		return nil, err
	}
	listed, err := h.grantService.ListProjectMembers(ctx, service.ListProjectMembersInput{
		ProjectID:   projectID,
		MinRelation: string(params.Relation.Value),
		PageToken:   string(params.PageToken.Value),
		Limit:       int(params.Limit.Value),
	})
	if err != nil {
		return nil, err
	}
	res := &api.ListProjectMembersResponse{Members: make([]api.ProjectMember, 0, len(listed.Members))}
	if listed.NextPageToken != "" {
		res.NextPageToken = api.NewOptNilPageToken(api.PageToken(listed.NextPageToken))
	}
	for _, member := range listed.Members {
		res.Members = append(res.Members, projectMemberResponse(member))
	}
	return res, nil
}

func projectMemberResponse(member *service.ProjectMember) api.ProjectMember {
	sources := make([]api.ProjectMemberSource, 0, len(member.Sources))
	for _, source := range member.Sources {
		if source.OwningTeam {
			sources = append(sources, api.NewProjectMemberOwningTeamSourceProjectMemberSource(api.ProjectMemberOwningTeamSource{
				Type: api.ProjectMemberOwningTeamSourceTypeOwningTeam,
				Team: projectMemberTeamRef(source.TeamID, source.TeamName),
			}))
			continue
		}
		grant := api.ProjectMemberGrantSource{Type: api.ProjectMemberGrantSourceTypeGrant, GrantID: source.GrantID}
		if source.TeamID != "" {
			grant.Team = api.NewOptTeamRef(projectMemberTeamRef(source.TeamID, source.TeamName))
		}
		sources = append(sources, api.NewProjectMemberGrantSourceProjectMemberSource(grant))
	}
	return api.ProjectMember{
		User:     userRefToAPI(member.User),
		Relation: api.ProjectMemberRelation(member.Relation),
		Sources:  sources,
	}
}

func projectMemberTeamRef(teamID, name string) api.TeamRef {
	out := api.TeamRef{TeamID: teamID}
	if name != "" {
		out.Name = api.NewOptString(name)
	}
	return out
}
