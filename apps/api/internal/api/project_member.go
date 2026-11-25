package api

import (
	"context"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
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
	return api.ProjectMember{
		User:     userRefToAPI(member.User),
		Relation: api.ProjectMemberRelation(member.Relation),
		Sources:  projectMemberSources(member.Sources),
	}
}

// projectMemberSources is the members list's wire shape of sources, which
// invitation lookup's membership shares.
func projectMemberSources(sources []domain.ProjectMemberSourceRecord) []api.ProjectMemberSource {
	return mapProjectMemberSources(sources,
		func(team api.TeamRef) api.ProjectMemberSource {
			return api.NewProjectMemberOwningTeamSourceProjectMemberSource(api.ProjectMemberOwningTeamSource{
				Type: api.ProjectMemberOwningTeamSourceTypeOwningTeam,
				Team: team,
			})
		},
		func(grantID string, team api.OptTeamRef) api.ProjectMemberSource {
			return api.NewProjectMemberGrantSourceProjectMemberSource(api.ProjectMemberGrantSource{
				Type:    api.ProjectMemberGrantSourceTypeGrant,
				GrantID: grantID,
				Team:    team,
			})
		},
	)
}

// mapProjectMemberSources walks domain sources once for both the members and
// admins wire shapes: owning_team first, then grants, with an optional team
// on a grant.
func mapProjectMemberSources[S any](
	sources []domain.ProjectMemberSourceRecord,
	owningTeam func(api.TeamRef) S,
	grant func(grantID string, team api.OptTeamRef) S,
) []S {
	out := make([]S, 0, len(sources))
	for _, source := range sources {
		if source.OwningTeam {
			out = append(out, owningTeam(projectMemberTeamRef(source.TeamID, source.TeamName)))
			continue
		}
		var team api.OptTeamRef
		if source.TeamID != "" {
			team = api.NewOptTeamRef(projectMemberTeamRef(source.TeamID, source.TeamName))
		}
		out = append(out, grant(source.GrantID, team))
	}
	return out
}

func projectMemberTeamRef(teamID, name string) api.TeamRef {
	out := api.TeamRef{TeamID: teamID}
	if name != "" {
		out.Name = api.NewOptString(name)
	}
	return out
}
