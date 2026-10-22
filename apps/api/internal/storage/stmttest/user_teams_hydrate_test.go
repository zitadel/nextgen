//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// listUsersWithTeams lists a project's users with their team memberships
// embedded, which is what UserQueryOptions.IncludeTeams exists for.
func listUsersWithTeams(t *testing.T, d dialect, projectID string, opts service.UserQueryOptions) []*domain.User {
	t.Helper()

	opts.IncludeTeams = true
	list, err := d.stmts.ListUsers(unfilteredListCtx(t), &database.ListOptions[domain.UserField]{
		Filter: database.Equal(database.Col(domain.UserFieldProjectID), projectID),
		Pagination: database.Page[domain.UserField]{
			Limit: 50,
			OrderBy: database.OrderBy[domain.UserField]{
				Columns: []database.Column[domain.UserField]{
					database.Col(domain.UserFieldID),
				},
				Direction: database.OrderAsc,
			},
		},
	}, opts)
	require.NoError(t, err)
	return list.Items
}

func addMembership(t *testing.T, d dialect, projectID, teamID, userID string, status domain.MembershipStatus) {
	t.Helper()

	require.NoError(t, d.stmts.CreateTeamMembership(t.Context(), &domain.TeamMembership{
		ProjectID: projectID,
		TeamID:    teamID,
		UserID:    userID,
		Status:    status,
	}))
}

func TestUserStatements_ListUsersHydratesTeams(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		teamA := newTestTeam(projectID, "team_a_"+uniqueSuffix(t))
		teamB := newTestTeam(projectID, "team_b_"+uniqueSuffix(t))
		// Names decide the order, so pin them rather than relying on
		// the random ones newTestTeam mints.
		teamA.Name = "alpha-" + teamA.ID
		teamB.Name = "beta-" + teamB.ID
		require.NoError(t, d.stmts.CreateTeam(t.Context(), teamA))
		require.NoError(t, d.stmts.CreateTeam(t.Context(), teamB))

		onBoth := "user_both_" + uniqueSuffix(t)
		onNone := "user_none_" + uniqueSuffix(t)
		for _, id := range []string{onBoth, onNone} {
			require.NoError(t, d.stmts.CreateUser(t.Context(),
				newTestUser(t, projectID, schemaURL, id, id+"@example.com", "Member")))
			t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, id) })
		}
		addMembership(t, d, projectID, teamA.ID, onBoth, domain.MembershipStatusActive)
		addMembership(t, d, projectID, teamB.ID, onBoth, domain.MembershipStatusPending)

		byID := map[string]*domain.User{}
		for _, u := range listUsersWithTeams(t, d, projectID, service.UserQueryOptions{}) {
			byID[u.ID] = u
		}

		both := byID[onBoth]
		require.NotNil(t, both)
		require.Len(t, both.Teams, 2)
		// Ordered by team name, and each entry carries the team's name so a
		// page renders without resolving ids one by one.
		assert.Equal(t, teamA.ID, both.Teams[0].TeamID)
		assert.Equal(t, teamA.Name, both.Teams[0].TeamName)
		assert.Equal(t, domain.MembershipStatusActive, both.Teams[0].Status)
		assert.Equal(t, teamB.ID, both.Teams[1].TeamID)
		// Pending still counts as a membership: not yet accepted, but not gone.
		assert.Equal(t, domain.MembershipStatusPending, both.Teams[1].Status)
		assert.False(t, both.TeamsTruncated)

		// Asked for, but this user has no memberships: an empty list, not a
		// missing one. The API layer maps nil to an absent property and this to [].
		none := byID[onNone]
		require.NotNil(t, none)
		assert.NotNil(t, none.Teams)
		assert.Empty(t, none.Teams)
		assert.False(t, none.TeamsTruncated)

		// Attributes survive the membership hydrate. Grouping the page clears
		// Attributes before refilling them, so a second grouping pass would
		// leave every expanded user with none — silently, since the teams
		// themselves would still look right.
		for _, u := range []*domain.User{both, none} {
			email, ok := u.Attributes.Get("email")
			assert.True(t, ok, "expansion must not drop hydrated attributes")
			assert.Equal(t, u.ID+"@example.com", email)
		}
	})
}

func TestUserStatements_ListUsersOmitsTeamsUnlessAsked(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		team := newTestTeam(projectID, "team_unasked_"+uniqueSuffix(t))
		require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
		userID := "user_unasked_" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUser(t.Context(),
			newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Unasked")))
		t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })
		addMembership(t, d, projectID, team.ID, userID, domain.MembershipStatusActive)

		list, err := d.stmts.ListUsers(unfilteredListCtx(t), &database.ListOptions[domain.UserField]{
			Filter:     database.Equal(database.Col(domain.UserFieldProjectID), projectID),
			Pagination: database.Page[domain.UserField]{Limit: 50},
		}, service.UserQueryOptions{})
		require.NoError(t, err)

		require.NotEmpty(t, list.Items)
		for _, u := range list.Items {
			assert.Nil(t, u.Teams, "memberships must stay nil when the read did not ask for them")
			assert.False(t, u.TeamsTruncated)
		}
	})
}

func TestUserStatements_ListUsersTeamsRespectsCap(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		userID := "user_capped_" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUser(t.Context(),
			newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Capped")))
		t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })

		// Names are zero-padded so lexical order is the numeric one and the
		// cap is asserted against a known prefix of the list.
		const total = 5
		for i := range total {
			team := newTestTeam(projectID, fmt.Sprintf("team_cap_%d"+"_%s", i, uniqueSuffix(t)))
			team.Name = fmt.Sprintf("cap-%02d-%s", i, team.ID)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
			addMembership(t, d, projectID, team.ID, userID, domain.MembershipStatusActive)
		}

		t.Run("under the cap is not truncated", func(t *testing.T) {
			users := listUsersWithTeams(t, d, projectID, service.UserQueryOptions{TeamsLimit: total})
			require.Len(t, users, 1)
			assert.Len(t, users[0].Teams, total)
			assert.False(t, users[0].TeamsTruncated, "a list that exactly fills the cap is not truncated")
		})

		t.Run("over the cap is cut and flagged", func(t *testing.T) {
			users := listUsersWithTeams(t, d, projectID, service.UserQueryOptions{TeamsLimit: 3})
			require.Len(t, users, 1)
			require.Len(t, users[0].Teams, 3)
			assert.True(t, users[0].TeamsTruncated)
			// The kept entries are the first by name, not an arbitrary subset.
			for i, team := range users[0].Teams {
				assert.Contains(t, team.TeamName, fmt.Sprintf("cap-%02d-", i))
			}
		})
	})
}

func TestUserStatements_ListUsersTeamsExcludesRemovedMemberships(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		team := newTestTeam(projectID, "team_removed_"+uniqueSuffix(t))
		require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
		userID := "user_removed_" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUser(t.Context(),
			newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Removed")))
		t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })

		addMembership(t, d, projectID, team.ID, userID, domain.MembershipStatusActive)
		require.NoError(t, d.stmts.UpdateTeamMembershipStatus(
			t.Context(), projectID, team.ID, userID, domain.MembershipStatusRemoved))

		users := listUsersWithTeams(t, d, projectID, service.UserQueryOptions{})
		require.Len(t, users, 1)
		// A removed membership is history — same rule the paginated
		// ListUserTeams read follows.
		assert.Empty(t, users[0].Teams)
	})
}

// Expansion must not perturb the page: it runs after the user query, so the
// same page token has to come back whether or not memberships were asked for.
func TestUserStatements_ListUsersTeamsDoesNotPerturbCursor(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		team := newTestTeam(projectID, "team_cursor_"+uniqueSuffix(t))
		require.NoError(t, d.stmts.CreateTeam(t.Context(), team))

		// The first user sits on several teams: a join would let it swallow the
		// page and hand back a different cursor.
		var firstUserID string
		for i := range 3 {
			userID := fmt.Sprintf("user_cursor_%d"+"_%s", i, uniqueSuffix(t))
			require.NoError(t, d.stmts.CreateUser(t.Context(),
				newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Cursor")))
			t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })
			if i == 0 {
				firstUserID = userID
			}
		}
		for i := range 3 {
			extra := newTestTeam(projectID, fmt.Sprintf("team_cursor_extra_%d"+"_%s", i, uniqueSuffix(t)))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), extra))
			addMembership(t, d, projectID, extra.ID, firstUserID, domain.MembershipStatusActive)
		}

		page := func(includeTeams bool) *database.ListResult[*domain.User] {
			t.Helper()
			list, err := d.stmts.ListUsers(unfilteredListCtx(t), &database.ListOptions[domain.UserField]{
				Filter: database.Equal(database.Col(domain.UserFieldProjectID), projectID),
				Pagination: database.Page[domain.UserField]{
					Limit: 2,
					OrderBy: database.OrderBy[domain.UserField]{
						Columns:   []database.Column[domain.UserField]{database.Col(domain.UserFieldID)},
						Direction: database.OrderAsc,
					},
				},
			}, service.UserQueryOptions{IncludeTeams: includeTeams})
			require.NoError(t, err)
			return list
		}

		plain, expanded := page(false), page(true)

		// LIMIT counts users either way, so the same two rows come back.
		require.Len(t, plain.Items, 2)
		require.Len(t, expanded.Items, 2)
		for i := range plain.Items {
			assert.Equal(t, plain.Items[i].ID, expanded.Items[i].ID)
		}
		assert.Equal(t, plain.NextCursor, expanded.NextCursor,
			"a page token means the same thing with and without expansion")
	})
}
