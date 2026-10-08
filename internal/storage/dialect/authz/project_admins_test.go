package authz_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

func TestGroupProjectAdmins(t *testing.T) {
	t.Parallel()

	got := authz.GroupProjectAdminSourcesByUser([]authz.ProjectAdminSourceRow{
		{UserID: "user_a", HomeProjectID: "proj_home", SourceRank: 0, TeamID: "team_owner", Visible: true, TeamName: "Acme"},
		{UserID: "user_a", HomeProjectID: "proj_home", SourceRank: 1, GrantID: "asgn_1", TeamID: "team_ops"},
		{UserID: "user_a", HomeProjectID: "proj_home", SourceRank: 2, GrantID: "asgn_2", Visible: true},
		{UserID: "user_b", HomeProjectID: "proj_home", SourceRank: 1, GrantID: "asgn_1", TeamID: "team_ops"},
	})

	assert.Equal(t, []*domain.ProjectAdminRecord{
		{UserID: "user_a", HomeProjectID: "proj_home", Visible: true, Sources: []domain.ProjectAdminSourceRecord{
			{OwningTeam: true, TeamID: "team_owner", TeamName: "Acme"},
			{GrantID: "asgn_1", TeamID: "team_ops"},
			{GrantID: "asgn_2"},
		}},
		{UserID: "user_b", HomeProjectID: "proj_home", Sources: []domain.ProjectAdminSourceRecord{
			{GrantID: "asgn_1", TeamID: "team_ops"},
		}},
	}, got, "one record per person, sources in row order; one visible source makes the person visible")
	assert.Empty(t, authz.GroupProjectAdminSourcesByUser(nil))
}
