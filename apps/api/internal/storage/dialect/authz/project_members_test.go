package authz_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

func TestGroupProjectMembers(t *testing.T) {
	t.Parallel()

	got := authz.GroupProjectMemberSourcesByUser([]authz.ProjectMemberSourceRow{
		{UserID: "user_a", HomeProjectID: "proj_home", SourceRank: 0, TeamID: "team_owner", Relation: "admin", TeamName: "Acme"},
		{UserID: "user_a", HomeProjectID: "proj_home", SourceRank: 1, GrantID: "asgn_1", TeamID: "team_ops", Relation: "viewer"},
		{UserID: "user_a", HomeProjectID: "proj_home", SourceRank: 2, GrantID: "asgn_2", Relation: "admin"},
		{UserID: "user_b", HomeProjectID: "proj_home", SourceRank: 1, GrantID: "asgn_1", TeamID: "team_ops", Relation: "viewer"},
		{UserID: "user_b", HomeProjectID: "proj_home", SourceRank: 2, GrantID: "asgn_3", Relation: "editor"},
		{UserID: "user_b", HomeProjectID: "proj_home", SourceRank: 2, GrantID: "asgn_4", Relation: "editor"},
	})

	assert.Equal(t, []*domain.ProjectMemberRecord{
		{UserID: "user_a", HomeProjectID: "proj_home", Relation: "admin", Sources: []domain.ProjectMemberSourceRecord{
			{OwningTeam: true, TeamID: "team_owner", TeamName: "Acme"},
			{GrantID: "asgn_2"},
		}},
		{UserID: "user_b", HomeProjectID: "proj_home", Relation: "editor", Sources: []domain.ProjectMemberSourceRecord{
			{GrantID: "asgn_3"},
			{GrantID: "asgn_4"},
		}},
	}, got, "one record per person, with the strongest role and its sources in row order")
	assert.Empty(t, authz.GroupProjectMemberSourcesByUser(nil))
}
