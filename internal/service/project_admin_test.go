package service_test

import (
	"context"
	"reflect"
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
	// Each grant source asks for one principal type; serve it only those.
	for _, principalType := range []domain.AuthzPrincipalType{domain.AuthzPrincipalTypeTeam, domain.AuthzPrincipalTypeUser} {
		want := database.And(
			database.StringEqual(database.Col(domain.AuthzAssignmentFieldRelation), domain.AuthzRelationAdmin),
			database.StringEqual(database.Col(domain.AuthzAssignmentFieldPrincipalType), principalType.String()),
		)
		var items []*domain.AuthzAssignment
		for _, grant := range f.grants {
			if grant.PrincipalType == principalType {
				items = append(items, grant)
			}
		}
		s.EXPECT().ListManagedGrants(gomock.Any(), "proj_customer", gomock.Cond(func(opts *database.ListOptions[domain.AuthzAssignmentField]) bool {
			return reflect.DeepEqual(opts.Filter, want)
		})).Return(&database.ListResult[*domain.AuthzAssignment]{Items: items}, nil).AnyTimes()
	}
	s.EXPECT().ListTeams(gomock.Any(), gomock.Any()).DoAndReturn(
		func(context.Context, *database.ListOptions[domain.TeamField]) (*database.ListResult[*domain.Team], error) {
			items := make([]*domain.Team, 0, len(f.teams))
			for id, name := range f.teams {
				items = append(items, &domain.Team{ID: id, Name: name})
			}
			return &database.ListResult[*domain.Team]{Items: items}, nil
		}).AnyTimes()
	s.EXPECT().ListUsers(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ *database.ListOptions[domain.UserField], opts service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
			var items []*domain.User
			for _, id := range f.members[*opts.MembershipTeamID] {
				items = append(items, &domain.User{ID: id})
			}
			return &database.ListResult[*domain.User]{Items: items}, nil
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

	past := time.Now().Add(-time.Hour)
	future := time.Now().Add(time.Hour)
	fixture := adminFixture{
		owningTeamID: "team_owner",
		grants: []*domain.AuthzAssignment{
			adminGrant("asgn_a", domain.AuthzPrincipalTypeUser, "user_owner", nil),
			adminGrant("asgn_b", domain.AuthzPrincipalTypeTeam, "team_ops", &future),
			adminGrant("asgn_c", domain.AuthzPrincipalTypeUser, "user_direct", nil),
			adminGrant("asgn_d", domain.AuthzPrincipalTypeUser, "user_expired", &past),
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
		for _, admin := range got {
			byUser[admin.User.UserID] = admin
			order = append(order, admin.User.UserID)
		}
		assert.Equal(t, []string{"user_direct", "user_ops", "user_owner"}, order,
			"ordered by user id; the expired grant is not an admin source")

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
		assert.Empty(t, got)
	})

}
