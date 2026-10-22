//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// listUsersWithOwnerTeam lists a project's users with the team that owns each
// one's lifecycle embedded, which is what
// UserQueryOptions.IncludeLifecycleOwnerTeam exists for.
func listUsersWithOwnerTeam(t *testing.T, d dialect, projectID string) []*domain.User {
	t.Helper()

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
	}, service.UserQueryOptions{IncludeLifecycleOwnerTeam: true})
	require.NoError(t, err)
	return list.Items
}

func TestUserStatements_ListUsersHydratesLifecycleOwnerTeam(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		owner := newTestTeam(projectID, "team_owner_"+uniqueSuffix(t))
		require.NoError(t, d.stmts.CreateTeam(t.Context(), owner))

		ownedA := "user_owned_a_" + uniqueSuffix(t)
		ownedB := "user_owned_b_" + uniqueSuffix(t)
		selfOwned := "user_self_" + uniqueSuffix(t)

		// Two users share one owner: the hydrate reads the team once and
		// places it on both, which is the point of keying on distinct ids.
		for _, id := range []string{ownedA, ownedB} {
			user := newTestUser(t, projectID, schemaURL, id, id+"@example.com", "Owned")
			user.LifecycleOwnerTeamID = &owner.ID
			require.NoError(t, d.stmts.CreateUser(t.Context(), user))
			t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, id) })
		}
		require.NoError(t, d.stmts.CreateUser(t.Context(),
			newTestUser(t, projectID, schemaURL, selfOwned, selfOwned+"@example.com", "Self")))
		t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, selfOwned) })

		byID := map[string]*domain.User{}
		for _, u := range listUsersWithOwnerTeam(t, d, projectID) {
			byID[u.ID] = u
		}

		for _, id := range []string{ownedA, ownedB} {
			user := byID[id]
			require.NotNil(t, user)
			require.NotNil(t, user.LifecycleOwnerTeam, "the owner team must be resolved for %s", id)
			assert.Equal(t, owner.ID, user.LifecycleOwnerTeam.ID)
			assert.Equal(t, owner.Name, user.LifecycleOwnerTeam.Name)
			assert.Equal(t, domain.TeamStatusActive, user.LifecycleOwnerTeam.Status)
			assert.Equal(t, projectID, user.LifecycleOwnerTeam.ProjectID)
			assert.False(t, user.LifecycleOwnerTeam.CreatedAt.IsZero())
			assert.True(t, user.LifecycleOwnerTeamLoaded)
		}

		// Asked for, but this user owns their own lifecycle: nothing to
		// resolve. The API layer maps loaded-and-nil to null, and not-loaded
		// to an absent property.
		self := byID[selfOwned]
		require.NotNil(t, self)
		assert.Nil(t, self.LifecycleOwnerTeam)
		assert.True(t, self.LifecycleOwnerTeamLoaded)

		// Attributes survive the second read, the same way they must survive
		// the membership hydrate: grouping the page clears them before
		// refilling, so a stray second grouping pass would empty them.
		for _, u := range []*domain.User{byID[ownedA], self} {
			email, ok := u.Attributes.Get("email")
			assert.True(t, ok, "expansion must not drop hydrated attributes")
			assert.Equal(t, u.ID+"@example.com", email)
		}
	})
}

func TestUserStatements_ListUsersOmitsOwnerTeamUnlessAsked(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		owner := newTestTeam(projectID, "team_unasked_owner_"+uniqueSuffix(t))
		require.NoError(t, d.stmts.CreateTeam(t.Context(), owner))
		userID := "user_unasked_owner_" + uniqueSuffix(t)
		user := newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Unasked")
		user.LifecycleOwnerTeamID = &owner.ID
		require.NoError(t, d.stmts.CreateUser(t.Context(), user))
		t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })

		list, err := d.stmts.ListUsers(unfilteredListCtx(t), &database.ListOptions[domain.UserField]{
			Filter:     database.Equal(database.Col(domain.UserFieldProjectID), projectID),
			Pagination: database.Page[domain.UserField]{Limit: 50},
		}, service.UserQueryOptions{})
		require.NoError(t, err)

		require.NotEmpty(t, list.Items)
		for _, u := range list.Items {
			assert.Nil(t, u.LifecycleOwnerTeam, "the owner team must stay nil when the read did not ask")
			assert.False(t, u.LifecycleOwnerTeamLoaded)
		}
		// The id itself is unconditional — expanding resolves it, it does not
		// reveal it.
		var found bool
		for _, u := range list.Items {
			if u.ID == userID {
				found = true
				require.NotNil(t, u.LifecycleOwnerTeamID)
				assert.Equal(t, owner.ID, *u.LifecycleOwnerTeamID)
			}
		}
		assert.True(t, found)
	})
}
