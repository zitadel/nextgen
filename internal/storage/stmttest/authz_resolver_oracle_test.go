//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"fmt"
	"math/rand"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/authz/resolver"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestAuthzResolver_OracleAgreement(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		persisted, err := d.stmts.LoadCatalogMutations(t.Context(), domain.SystemCatalogID)
		require.NoError(t, err)

		projectID := ensureProject(t, d.stmts)
		teamA := "team_ora_a_" + uniqueSuffix(t)
		teamB := "team_ora_b_" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamA)))
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamB)))

		rng := rand.New(rand.NewSource(42))
		users := make([]string, 6)
		for i := range users {
			users[i] = fmt.Sprintf("user_ora_%d_%s", i, uniqueSuffix(t))
		}

		var assignments []*domain.AuthzAssignment
		var memberships []*domain.AuthzMembershipEdge
		var resources []*domain.ResourceScope

		for i, u := range users {
			scope := domain.NewUserResourceScope(projectID, u)
			if i%2 == 1 {
				tid := teamA
				scope.TeamID = &tid
			}
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), scope))
			resources = append(resources, scope)
		}

		for _, u := range users {
			if rng.Intn(2) == 0 {
				e := domain.NewUserTeamMembershipEdge(projectID, teamA, u)
				require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), e))
				memberships = append(memberships, e)
			}
			if rng.Intn(3) == 0 {
				e := domain.NewUserTeamMembershipEdge(projectID, teamB, u)
				require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), e))
				memberships = append(memberships, e)
			}
		}

		for _, u := range users[:3] {
			if rng.Intn(2) == 0 {
				a := newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewProjectAssignmentScope())
				require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), a))
				assignments = append(assignments, a)
			}
		}
		aTeam := newTestAssignment(projectID, "", domain.AuthzPrincipalTypeTeam, teamA, "project", "viewer", domain.NewProjectAssignmentScope())
		require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), aTeam))
		assignments = append(assignments, aTeam)

		if rng.Intn(2) == 0 {
			aTS := newTestAssignment(projectID, "", domain.AuthzPrincipalTypeTeam, teamB, "project", "team", domain.NewProjectAssignmentScope())
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), aTS))
			assignments = append(assignments, aTS)
		}

		scopedUser := users[0]
		aScoped := newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, scopedUser, "project", "viewer", domain.NewTeamAssignmentScope(teamA))
		require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), aScoped))
		assignments = append(assignments, aScoped)

		g := resolver.GraphFromPersisted(persisted)
		g.Assignments = assignments
		g.Memberships = memberships
		g.Resources = resources

		r := resolver.New()
		for _, u := range users {
			wantAllow := g.OracleCheck(projectID, projectID, domain.AuthzPrincipalTypeUser, u, "project", "viewer")
			dec, err := r.Check(t.Context(), d.stmts, resolver.Request{
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   u,
				ProjectID:     projectID,
				ObjectType:    "project",
				Relation:      "viewer",
			})
			require.NoError(t, err)
			gotAllow := dec == resolver.DecisionAllow
			assert.Equalf(t, wantAllow, gotAllow, "check viewer user=%s decision=%s", u, dec)

			if !gotAllow {
				wantFoot := g.OracleFoothold(projectID, "", domain.AuthzPrincipalTypeUser, u)
				if wantFoot {
					assert.Equal(t, resolver.DecisionForbidden, dec, "user=%s", u)
				} else {
					assert.Equal(t, resolver.DecisionNotFound, dec, "user=%s", u)
				}
			}

			wantList := g.OracleList(projectID, projectID, domain.AuthzPrincipalTypeUser, u, domain.ResourceKindUser, "project", "viewer")
			gotList, err := r.ListObjects(t.Context(), d.stmts, resolver.ListRequest{
				Request: resolver.Request{
					PrincipalType: domain.AuthzPrincipalTypeUser,
					PrincipalID:   u,
					ProjectID:     projectID,
					ObjectType:    "project",
					Relation:      "viewer",
				},
				ResourceKind: domain.ResourceKindUser,
			})
			require.NoError(t, err)
			assert.ElementsMatchf(t, wantList, gotList, "list user=%s", u)
		}
	})
}

// TestAuthzResolver_OracleAgreementForeignTeamGrant pins SQL Check/List/Foothold
// to the in-memory oracle when membership lives in a different project than the
// grant (the #1117 foothold-home contract).
func TestAuthzResolver_OracleAgreementForeignTeamGrant(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		grant := seedForeignTeamGrant(t, d.stmts, true)
		res := "usr_ora_ft_" + uniqueSuffix(t)
		require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), domain.NewUserResourceScope(grant.customer, res)))

		persisted, err := d.stmts.LoadCatalogMutations(t.Context(), domain.SystemCatalogID)
		require.NoError(t, err)
		g := resolver.GraphFromPersisted(persisted)
		asgns, err := d.stmts.ListAuthzAssignments(t.Context(), grant.customer, domain.AuthzPrincipalTypeTeam, grant.teamID, false)
		require.NoError(t, err)
		g.Assignments = asgns
		g.Memberships = []*domain.AuthzMembershipEdge{
			domain.NewUserTeamMembershipEdge(grant.platform, grant.teamID, grant.userID),
		}
		g.Resources = []*domain.ResourceScope{domain.NewUserResourceScope(grant.customer, res)}

		r := resolver.New()
		viewer := resolver.Request{
			PrincipalType: domain.AuthzPrincipalTypeUser,
			PrincipalID:   grant.userID,
			ProjectID:     grant.customer,
			HomeProjectID: grant.platform,
			ObjectType:    "project",
			Relation:      "viewer",
		}

		wantAllow := g.OracleCheck(grant.customer, grant.platform, domain.AuthzPrincipalTypeUser, grant.userID, "project", "viewer")
		dec, err := r.Check(t.Context(), d.stmts, viewer)
		require.NoError(t, err)
		assert.True(t, wantAllow)
		assert.Equal(t, resolver.DecisionAllow, dec)

		member := viewer
		member.ObjectType = "team"
		member.Relation = "member"
		wantMember := g.OracleCheck(grant.customer, grant.platform, domain.AuthzPrincipalTypeUser, grant.userID, "team", "member")
		memberDec, err := r.Check(t.Context(), d.stmts, member)
		require.NoError(t, err)
		assert.False(t, wantMember)
		assert.True(t, g.OracleFoothold(grant.customer, grant.platform, domain.AuthzPrincipalTypeUser, grant.userID))
		assert.Equal(t, resolver.DecisionForbidden, memberDec)

		wantList := g.OracleList(grant.customer, grant.platform, domain.AuthzPrincipalTypeUser, grant.userID, domain.ResourceKindUser, "project", "viewer")
		gotList, err := r.ListObjects(t.Context(), d.stmts, resolver.ListRequest{
			Request:      viewer,
			ResourceKind: domain.ResourceKindUser,
		})
		require.NoError(t, err)
		assert.ElementsMatch(t, wantList, gotList)
		assert.Contains(t, gotList, res)

		emptyHome := viewer
		emptyHome.HomeProjectID = ""
		assert.False(t, g.OracleCheck(grant.customer, "", domain.AuthzPrincipalTypeUser, grant.userID, "project", "viewer"))
		assert.False(t, g.OracleFoothold(grant.customer, "", domain.AuthzPrincipalTypeUser, grant.userID))
		// Home is not part of the per-request memo key (one credential home
		// per Resolver), so empty-home must not reuse r.
		emptyDec, err := resolver.New().Check(t.Context(), d.stmts, emptyHome)
		require.NoError(t, err)
		assert.Equal(t, resolver.DecisionNotFound, emptyDec)
	})
}
