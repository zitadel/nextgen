//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// listTestSessions seeds a project with n multi-factor sessions bound to one user.
func listTestSessions(t *testing.T, d dialect, n int) (projectID, userID string, want []string) {
	t.Helper()
	projectID, schemaURL := ensureUserTestProject(t, d.stmts)
	user := newTestUser(t, projectID, schemaURL, "user-list-"+uniqueSuffix(t), "list-"+uniqueSuffix(t)+"@example.com", "List User")
	require.NoError(t, d.stmts.CreateUser(t.Context(), user))
	return projectID, user.ID, seedActiveSessions(t, d.stmts, projectID, user.ID, n)
}

func projectFilter(projectID string) database.Filter[domain.SessionField] {
	return database.Equal(database.Col(domain.SessionFieldProjectID), projectID)
}

func orderByID(direction database.OrderDirection) database.OrderBy[domain.SessionField] {
	return database.OrderBy[domain.SessionField]{
		Columns:   []database.Column[domain.SessionField]{database.Col(domain.SessionFieldID)},
		Direction: direction,
	}
}

// A session with two verified factors is two rows once checks are joined, so a
// limit applied to the joined result would both shorten the page and strip
// factors off its last session.
func TestSessionStatements_ListLimitsSessionsNotJoinedRows(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _, want := listTestSessions(t, d, 3)

		result := listSessions(t, d.stmts, projectFilter(projectID), database.Page[domain.SessionField]{
			Limit:   3,
			OrderBy: orderByID(database.OrderAsc),
		})

		assert.Equal(t, want, sessionIDs(result.Items))
		for _, session := range result.Items {
			assert.Len(t, session.Factors, 2, "session %s came back with an incomplete factor list", session.ID)
		}
	})
}

func TestSessionStatements_ListPagesThroughEverySession(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _, want := listTestSessions(t, d, 5)

		got := walkSessions(t, d.stmts, projectFilter(projectID), database.Page[domain.SessionField]{
			Limit:   2,
			OrderBy: orderByID(database.OrderAsc),
		}, 2)

		assert.Equal(t, want, got, "every session must be reachable across pages, exactly once")
	})
}

func TestSessionStatements_ListPagesDescending(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _, want := listTestSessions(t, d, 5)
		slices.Reverse(want)

		got := walkSessions(t, d.stmts, projectFilter(projectID), database.Page[domain.SessionField]{
			Limit:   2,
			OrderBy: orderByID(database.OrderDesc),
		}, 2)

		assert.Equal(t, want, got)
	})
}

func TestSessionStatements_ListFiltersByUserID(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, userID, want := listTestSessions(t, d, 2)
		// Anonymous sessions in the same project must not match.
		seedBuildingSessions(t, d.stmts, projectID, 2)

		result := listSessions(t, d.stmts, database.And(
			projectFilter(projectID),
			database.Equal(database.Col(domain.SessionFieldUserID), userID),
		), database.Page[domain.SessionField]{OrderBy: orderByID(database.OrderAsc)})

		assert.Equal(t, want, sessionIDs(result.Items))
	})
}

// building vs active is "has no verified factor", which needs an EXISTS over
// checks rather than a column comparison.
func TestSessionStatements_ListFiltersByVerifiedFactor(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _, active := listTestSessions(t, d, 3)
		building := seedBuildingSessions(t, d.stmts, projectID, 2)

		for _, tt := range []struct {
			name   string
			filter database.Filter[domain.SessionField]
			want   []string
			state  domain.SessionState
		}{
			{
				name:   "active",
				filter: database.IsTrue(database.Col(domain.SessionFieldHasVerifiedFactor)),
				want:   active,
				state:  domain.SessionStateActive,
			},
			{
				name:   "building",
				filter: database.IsFalse(database.Col(domain.SessionFieldHasVerifiedFactor)),
				want:   building,
				state:  domain.SessionStateBuilding,
			},
		} {
			t.Run(tt.name, func(t *testing.T) {
				result := listSessions(t, d.stmts, database.And(projectFilter(projectID), tt.filter),
					database.Page[domain.SessionField]{OrderBy: orderByID(database.OrderAsc)})

				assert.Equal(t, tt.want, sessionIDs(result.Items))
				for _, session := range result.Items {
					assert.Equal(t, tt.state, session.State())
				}
			})
		}
	})
}

func TestUserStatements_DeleteCascadesSessionAndToken(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		user := newTestUser(t, projectID, schemaURL, "user-cascade-"+uniqueSuffix(t), "cascade@example.com", "Cascade User")
		require.NoError(t, d.stmts.CreateUser(t.Context(), user))

		plain, _ := handoffCompletedAttemptWithUser(t, d.stmts, projectID, user.ID)
		exchanged, err := d.stmts.ExchangeSession(t.Context(), projectID, plain, nil, time.Hour)
		require.NoError(t, err)
		require.NotEmpty(t, exchanged.ID)
		require.NotEmpty(t, exchanged.TokenID)
		require.NotNil(t, exchanged.UserID)
		assert.Equal(t, user.ID, *exchanged.UserID)
		t.Cleanup(func() {
			_ = d.stmts.DeleteSessionByID(context.Background(), projectID, exchanged.ID)
		})

		tokenID := exchanged.TokenID
		sessionID := exchanged.ID

		require.NoError(t, d.stmts.DeleteUserByID(t.Context(), projectID, user.ID))

		_, err = d.stmts.GetSessionByID(t.Context(), projectID, sessionID)
		assert.True(t, errors.Is(err, domain.ErrSessionNotFound()), "session should cascade with user: %v", err)

		_, err = d.stmts.GetTokenByID(t.Context(), projectID, tokenID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError), "session token should cascade with user")
	})
}

// TestSessionStatements_ExchangeUpgradesSessionInPlace covers the #755 lifecycle:
// a flow persists an anonymous building session, its auth-attempt links to that
// session, and exchange upgrades the same row (building -> active) instead of
// creating a second session.
func TestSessionStatements_ExchangeUpgradesSessionInPlace(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		user := newTestUser(t, projectID, schemaURL, "user-upgrade-"+uniqueSuffix(t), "upgrade@example.com", "Upgrade User")
		require.NoError(t, d.stmts.CreateUser(t.Context(), user))

		// The anonymous building session persisted when the flow started.
		session, err := domain.NewSession(projectID, nil)
		require.NoError(t, err)
		require.NoError(t, d.stmts.CreateSession(t.Context(), session))
		require.NotEmpty(t, session.ID)
		require.Equal(t, domain.SessionStateBuilding, session.State())
		sessionID := session.ID
		t.Cleanup(func() {
			_ = d.stmts.DeleteSessionByID(context.Background(), projectID, sessionID)
		})

		// The flow's auth-attempt links to that session.
		plain, _ := handoffCompletedAttempt(t, d.stmts, projectID, func(a *domain.AuthAttempt) {
			a.SessionID = &sessionID
			a.RequiredChecks = []domain.AuthCheckType{domain.AuthCheckTypeUser, domain.AuthCheckTypePassword}
			a.Checks = []domain.AuthCheck{
				&domain.AuthFactorUser{UserID: user.ID},
				&domain.AuthFactorPassword{},
			}
		})

		exchanged, err := d.stmts.ExchangeSession(t.Context(), projectID, plain, nil, time.Hour)
		require.NoError(t, err)
		// Same session, upgraded in place: no duplicate id.
		require.Equal(t, sessionID, exchanged.ID, "exchange must upgrade the existing session, not mint a new one")
		require.NotNil(t, exchanged.UserID)
		assert.Equal(t, user.ID, *exchanged.UserID)
		assert.Equal(t, domain.SessionStateActive, exchanged.State())

		got, err := d.stmts.GetSessionByID(t.Context(), projectID, sessionID)
		require.NoError(t, err)
		assert.Equal(t, domain.SessionStateActive, got.State())
		assert.NotEmpty(t, got.Factors, "verified factors promoted onto the upgraded session")
	})
}
