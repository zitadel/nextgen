package service_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// adminFixture is the set of facts ListProjectAdmins reads, served by the mocked
// statements: the owning team, the project's admin grants, the active members
// of each team, and team names.
type adminFixture struct {
	owningTeamID string
	grants       []*domain.AuthzAssignment
	members      map[string][]string
	teams        map[string]string
}

func (f adminFixture) expect(s *servicemocks.MockAllStatements) {
	s.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_customer").DoAndReturn(
		func(context.Context, string) (*domain.AuthzAssignment, error) {
			if f.owningTeamID == "" {
				return nil, new(database.NoRowFoundError)
			}
			return domain.NewClaimTeamAssignment("proj_customer", f.owningTeamID), nil
		}).AnyTimes()
	// The team-grant source reads first, then the user-grant source; each gets
	// only its own principal type, as its filter asks. Expiry is filtered in
	// SQL, which the integration test covers.
	byType := func(principalType domain.AuthzPrincipalType) []*domain.AuthzAssignment {
		var items []*domain.AuthzAssignment
		for _, grant := range f.grants {
			if grant.PrincipalType == principalType {
				items = append(items, grant)
			}
		}
		return items
	}
	gomock.InOrder(
		s.EXPECT().ListManagedGrants(gomock.Any(), "proj_customer", gomock.Any()).Return(
			&database.ListResult[*domain.AuthzAssignment]{Items: byType(domain.AuthzPrincipalTypeTeam)}, nil),
		s.EXPECT().ListManagedGrants(gomock.Any(), "proj_customer", gomock.Any()).Return(
			&database.ListResult[*domain.AuthzAssignment]{Items: byType(domain.AuthzPrincipalTypeUser)}, nil),
	)
	s.EXPECT().ListTeams(gomock.Any(), gomock.Any()).DoAndReturn(
		func(context.Context, *database.ListOptions[domain.TeamField]) (*database.ListResult[*domain.Team], error) {
			items := make([]*domain.Team, 0, len(f.teams))
			for id, name := range f.teams {
				items = append(items, &domain.Team{ID: id, Name: name})
			}
			return &database.ListResult[*domain.Team]{Items: items}, nil
		}).AnyTimes()
	s.EXPECT().ListAuthzMembershipEdges(gomock.Any(), gomock.Any()).DoAndReturn(
		func(context.Context, database.Filter[domain.AuthzMembershipEdgeField]) ([]*domain.AuthzMembershipEdge, error) {
			var edges []*domain.AuthzMembershipEdge
			for teamID, userIDs := range f.members {
				for _, userID := range userIDs {
					edges = append(edges, domain.NewUserTeamMembershipEdge(grantPlatformProjID, teamID, userID))
				}
			}
			return edges, nil
		}).AnyTimes()
}

func adminGrant(id string, principalType domain.AuthzPrincipalType, principalID string, expiresAt *time.Time) *domain.AuthzAssignment {
	return &domain.AuthzAssignment{
		ID: id, ProjectID: "proj_customer", CatalogID: domain.SystemCatalogID,
		PrincipalType: principalType, PrincipalID: principalID,
		ObjectType: "project", Relation: "admin", ScopeKind: domain.AuthzScopeKindProject,
		ExpiresAt: expiresAt,
	}
}

func TestGrantService_ListProjectAdmins(t *testing.T) {
	t.Parallel()

	future := time.Now().Add(time.Hour)
	fixture := adminFixture{
		owningTeamID: "team_owner",
		grants: []*domain.AuthzAssignment{
			adminGrant("asgn_a", domain.AuthzPrincipalTypeUser, "user_owner", nil),
			adminGrant("asgn_b", domain.AuthzPrincipalTypeTeam, "team_ops", &future),
			adminGrant("asgn_c", domain.AuthzPrincipalTypeUser, "user_direct", nil),
		},
		members: map[string][]string{
			"team_owner": {"user_owner"},
			"team_ops":   {"user_ops", "user_direct"},
		},
		teams: map[string]string{"team_owner": "Acme", "team_ops": "Ops"},
	}

	t.Run("one entry per person with every source", func(t *testing.T) {
		t.Parallel()
		refs := &grantRefStub{byID: map[string]domain.UserRef{
			"user_owner": {UserID: "user_owner", Identifier: "owner@example.com", IdentifierProperty: "email"},
		}}
		svc := newMockedGrantServiceWithRefs(t, grantPlatformProjID, refs, fixture.expect)

		got, err := svc.ListProjectAdmins(t.Context(), "proj_customer")
		require.NoError(t, err)

		byUser := map[string]*service.ProjectAdmin{}
		var order []string
		for _, admin := range got.Admins {
			byUser[admin.User.UserID] = admin
			order = append(order, admin.User.UserID)
		}
		assert.Equal(t, []string{"user_direct", "user_ops", "user_owner"}, order, "ordered by user id")
		assert.False(t, got.Truncated)

		owner := byUser["user_owner"]
		assert.Equal(t, "owner@example.com", owner.User.Identifier)
		assert.Equal(t, []service.ProjectAdminSource{
			{Type: service.ProjectAdminSourceOwningTeam, Team: &service.TeamRef{TeamID: "team_owner", Name: "Acme"}},
			{Type: service.ProjectAdminSourceGrant, GrantID: "asgn_a"},
		}, owner.Sources, "owning team first, then the grant: one row, both sources")

		assert.Equal(t, []service.ProjectAdminSource{
			{Type: service.ProjectAdminSourceGrant, GrantID: "asgn_b", Team: &service.TeamRef{TeamID: "team_ops", Name: "Ops"}},
			{Type: service.ProjectAdminSourceGrant, GrantID: "asgn_c"},
		}, byUser["user_direct"].Sources, "the team grant before the direct grant")

		assert.Equal(t, "user_ops", byUser["user_ops"].User.UserID, "a missing ref degrades to the user id")
	})

	t.Run("unowned project without grants has no admins", func(t *testing.T) {
		t.Parallel()
		svc := newMockedGrantService(t, grantPlatformProjID, adminFixture{}.expect)

		got, err := svc.ListProjectAdmins(t.Context(), "proj_customer")
		require.NoError(t, err)
		assert.Empty(t, got.Admins)
	})

	t.Run("a list past the cap is truncated", func(t *testing.T) {
		t.Parallel()
		members := make([]string, 0, service.MaxProjectAdmins+1)
		for i := range service.MaxProjectAdmins + 1 {
			members = append(members, fmt.Sprintf("user_%05d", i))
		}
		svc := newMockedGrantService(t, grantPlatformProjID, adminFixture{
			owningTeamID: "team_big",
			members:      map[string][]string{"team_big": members},
			teams:        map[string]string{"team_big": "Everyone"},
		}.expect)

		got, err := svc.ListProjectAdmins(t.Context(), "proj_customer")
		require.NoError(t, err)
		assert.True(t, got.Truncated)
		require.Len(t, got.Admins, service.MaxProjectAdmins)
		assert.Equal(t, members[service.MaxProjectAdmins-1], got.Admins[service.MaxProjectAdmins-1].User.UserID,
			"the first people by user id are kept")
	})

}
