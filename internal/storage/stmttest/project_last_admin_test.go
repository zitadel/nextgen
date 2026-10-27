//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ProjectsLosingLastAdmin reports a project only when removal would leave it
// with nobody who can administer it. The sources are an active owning-team
// member, an existing user with an unexpired admin grant, and an active member
// of a team with an unexpired admin grant. One person with two sources counts
// once.
func TestAuthzAssignmentStatements_ProjectsLosingLastAdmin(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		home, schemaURL := ensureUserTestProject(t, d.stmts)
		suffix := uniqueSuffix(t)
		past := time.Now().Add(-time.Hour)

		user := func(name string) string {
			t.Helper()
			id := "usr-last-" + name + "-" + suffix
			require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, home, schemaURL, id, id+"@example.com", name)))
			return id
		}
		team := func(name string, members ...string) string {
			t.Helper()
			id := "team-last-" + name + "-" + suffix
			require.NoError(t, d.stmts.CreateTeam(t.Context(), &domain.Team{ProjectID: home, ID: id, Name: name}))
			for _, member := range members {
				require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdge(home, id, member)))
			}
			return id
		}
		grant := func(project string, principalType domain.AuthzPrincipalType, principalID, relation string, expiresAt *time.Time) string {
			t.Helper()
			assignment := &domain.AuthzAssignment{
				ProjectID:     project,
				CatalogID:     domain.SystemCatalogID,
				PrincipalType: principalType,
				PrincipalID:   principalID,
				ObjectType:    "project",
				Relation:      relation,
				ExpiresAt:     expiresAt,
			}
			assignment.ApplyScope(domain.NewProjectAssignmentScope())
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), assignment))
			return assignment.ID
		}
		losing := func(removal domain.AdminRemoval) []string {
			t.Helper()
			ids, err := d.stmts.ListProjectsLosingLastAdmin(t.Context(), removal)
			require.NoError(t, err)
			return ids
		}
		touched := func(removal domain.AdminRemoval) []string {
			t.Helper()
			ids, err := d.stmts.ListProjectsTouchedByAdminRemoval(t.Context(), removal)
			require.NoError(t, err)
			return ids
		}

		kept := ensureProject(t, d.stmts)
		first := user("a")
		second := user("b")
		firstGrant := grant(kept, domain.AuthzPrincipalTypeUser, first, "admin", nil)
		grant(kept, domain.AuthzPrincipalTypeUser, second, "admin", nil)
		assert.Empty(t, losing(domain.AdminRemoval{UserID: first}), "another person remains")
		assert.Empty(t, losing(domain.AdminRemoval{GrantID: firstGrant}))
		assert.Equal(t, []string{kept}, touched(domain.AdminRemoval{GrantID: firstGrant}))

		both := ensureProject(t, d.stmts)
		solo := user("solo")
		owners := team("owners", solo)
		require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), domain.NewClaimTeamAssignment(both, owners)))
		direct := grant(both, domain.AuthzPrincipalTypeUser, solo, "admin", nil)
		assert.Empty(t, losing(domain.AdminRemoval{GrantID: direct}), "the same person remains through the owning team")
		assert.Equal(t, []string{both}, losing(domain.AdminRemoval{UserID: solo}))

		last := ensureProject(t, d.stmts)
		only := user("only")
		onlyGrant := grant(last, domain.AuthzPrincipalTypeUser, only, "admin", nil)
		assert.Equal(t, []string{last}, losing(domain.AdminRemoval{UserID: only}), "the last person is reported")
		assert.Equal(t, []string{last}, losing(domain.AdminRemoval{GrantID: onlyGrant}))

		empty := ensureProject(t, d.stmts)
		viewer := user("viewer")
		viewerGrant := grant(empty, domain.AuthzPrincipalTypeUser, viewer, "viewer", nil)
		grant(empty, domain.AuthzPrincipalTypeUser, viewer, "editor", nil)
		assert.Empty(t, losing(domain.AdminRemoval{UserID: viewer}), "a project that is already empty is not reported")
		assert.Empty(t, touched(domain.AdminRemoval{GrantID: viewerGrant}))

		expiredProject := ensureProject(t, d.stmts)
		expiredUser := user("expired")
		expiredGrant := grant(expiredProject, domain.AuthzPrincipalTypeUser, expiredUser, "admin", &past)
		assert.Empty(t, touched(domain.AdminRemoval{GrantID: expiredGrant}))
		assert.Empty(t, losing(domain.AdminRemoval{UserID: expiredUser}))

		goneProject := ensureProject(t, d.stmts)
		gone := user("gone")
		grant(goneProject, domain.AuthzPrincipalTypeUser, gone, "admin", nil)
		require.NoError(t, d.stmts.DeleteUserByID(t.Context(), home, gone))
		assert.Empty(t, losing(domain.AdminRemoval{UserID: gone}), "a grant to a deleted user is not a person")

		left := ensureProject(t, d.stmts)
		right := ensureProject(t, d.stmts)
		span := user("span")
		other := user("other")
		grant(left, domain.AuthzPrincipalTypeUser, span, "admin", nil)
		grant(right, domain.AuthzPrincipalTypeUser, span, "admin", nil)
		grant(right, domain.AuthzPrincipalTypeUser, other, "admin", nil)
		spanRemoval := domain.AdminRemoval{UserID: span}
		assert.Equal(t, []string{left}, losing(spanRemoval), "only the project that would be emptied")
		wantTouched := []string{left, right}
		slices.Sort(wantTouched)
		assert.Equal(t, wantTouched, touched(spanRemoval))

		teamLeft := ensureProject(t, d.stmts)
		teamRight := ensureProject(t, d.stmts)
		member := user("member")
		teammate := user("teammate")
		onlyTeam := team("only", member)
		sharedTeam := team("shared", member, teammate)
		grant(teamLeft, domain.AuthzPrincipalTypeTeam, onlyTeam, "admin", nil)
		grant(teamRight, domain.AuthzPrincipalTypeTeam, sharedTeam, "admin", nil)
		grant(teamRight, domain.AuthzPrincipalTypeUser, other, "admin", nil)
		assert.Equal(t, []string{teamLeft}, losing(domain.AdminRemoval{TeamID: onlyTeam}))
		assert.Empty(t, losing(domain.AdminRemoval{TeamID: sharedTeam}), "the direct grant on the other project remains")
		assert.Equal(t, []string{teamLeft}, losing(domain.AdminRemoval{UserID: member}))
		assert.Empty(t, losing(domain.AdminRemoval{UserID: teammate}))
	})
}

func TestProjectStatements_LockProject(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		require.NoError(t, d.pool.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
			return tx.Statements().LockProject(ctx, projectID)
		}))
		err := d.pool.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
			return tx.Statements().LockProject(ctx, "proj_missing_"+uniqueSuffix(t))
		})
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}
