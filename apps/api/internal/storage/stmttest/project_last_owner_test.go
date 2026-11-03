//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ProjectsLosingLastOwner reports a project only when the user is the last
// active member of its owning team. Admin grants are not owners, and a member
// of two owning teams is reported for the projects where they are alone.
func TestAuthzAssignmentStatements_ProjectsLosingLastOwner(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		home, schemaURL := ensureUserTestProject(t, d.stmts)
		suffix := uniqueSuffix(t)

		user := func(name string) string {
			t.Helper()
			id := "usr-owner-" + name + "-" + suffix
			require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, home, schemaURL, id, id+"@example.com", name)))
			return id
		}
		team := func(name string, members ...string) string {
			t.Helper()
			id := "team-owner-" + name + "-" + suffix
			require.NoError(t, d.stmts.CreateTeam(t.Context(), &domain.Team{ProjectID: home, ID: id, Name: name}))
			for _, member := range members {
				require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdge(home, id, member)))
			}
			return id
		}
		owned := func(teamID string) string {
			t.Helper()
			project := ensureProject(t, d.stmts)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), domain.NewClaimTeamAssignment(project, teamID)))
			return project
		}
		adminGrant := func(project, userID string) {
			t.Helper()
			assignment := &domain.AuthzAssignment{
				ProjectID:     project,
				CatalogID:     domain.SystemCatalogID,
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   userID,
				ObjectType:    "project",
				Relation:      "admin",
			}
			assignment.ApplyScope(domain.NewProjectAssignmentScope())
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), assignment))
		}
		losing := func(userID string) []string {
			t.Helper()
			ids, err := d.stmts.ListProjectsLosingLastOwner(t.Context(), userID)
			require.NoError(t, err)
			return ids
		}
		ownedThrough := func(userID string) []string {
			t.Helper()
			ids, err := d.stmts.ListProjectsOwnedThroughMember(t.Context(), userID)
			require.NoError(t, err)
			return ids
		}

		solo := user("solo")
		soloProject := owned(team("solo", solo))
		assert.Equal(t, []string{soloProject}, losing(solo), "the last member is reported")
		assert.Equal(t, []string{soloProject}, ownedThrough(solo))

		first := user("first")
		second := user("second")
		sharedProject := owned(team("shared", first, second))
		assert.Empty(t, losing(first), "another member remains")
		assert.Equal(t, []string{sharedProject}, ownedThrough(first))

		admin := user("admin")
		grantedProject := owned(team("granted", admin))
		adminGrant(grantedProject, user("other"))
		assert.Equal(t, []string{grantedProject}, losing(admin), "an admin grant is not an owner")

		grantee := user("grantee")
		adminGrant(soloProject, grantee)
		assert.Empty(t, ownedThrough(grantee), "an admin grant alone owns nothing")

		span := user("span")
		mate := user("mate")
		left := owned(team("left", span))
		right := owned(team("right", span, mate))
		assert.Equal(t, []string{left}, losing(span), "only the project that would be left without an owner")
		want := []string{left, right}
		slices.Sort(want)
		assert.Equal(t, want, ownedThrough(span))

		gone := user("gone")
		owned(team("gone", gone))
		require.NoError(t, d.stmts.DeleteUserByID(t.Context(), home, gone))
		assert.Empty(t, ownedThrough(gone), "a deleted user's edges are gone")
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
