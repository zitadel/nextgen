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
				wantFoot := g.OracleFoothold(projectID, domain.AuthzPrincipalTypeUser, u)
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
