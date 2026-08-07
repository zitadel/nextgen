//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

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

func createAnonymousSession(t *testing.T, stmts service.AllStatements, projectID string) *domain.Session {
	t.Helper()
	session, err := domain.NewSession(projectID, nil)
	require.NoError(t, err)
	require.NoError(t, stmts.CreateSession(t.Context(), session))
	sessionID := session.ID
	t.Cleanup(func() {
		_ = stmts.DeleteSessionByID(context.Background(), projectID, sessionID)
	})
	return session
}

// createUserBoundSession exchanges a user-only attempt so the session carries
// a single check row: the joined page limit then counts sessions, keeping this
// suite independent of the LIMIT-over-joins bug (issue 766 comment).
func createUserBoundSession(t *testing.T, stmts service.AllStatements, projectID, userID string) *domain.Session {
	t.Helper()
	plain, _ := handoffCompletedAttempt(t, stmts, projectID, func(a *domain.AuthAttempt) {
		a.RequiredChecks = []domain.AuthCheckType{domain.AuthCheckTypeUser}
		a.Checks = []domain.AuthCheck{&domain.AuthFactorUser{UserID: userID}}
	})
	session, err := stmts.ExchangeSession(t.Context(), projectID, plain, nil, time.Hour)
	require.NoError(t, err)
	require.NotNil(t, session.UserID)
	sessionID := session.ID
	t.Cleanup(func() {
		_ = stmts.DeleteSessionByID(context.Background(), projectID, sessionID)
	})
	return session
}

// pageAllSessionIDs pages the project's sessions ordered by (user_id, id) with
// the given limit until the cursor runs dry, guarding against a paging loop
// that never terminates.
func pageAllSessionIDs(t *testing.T, stmts service.AllStatements, projectID string, direction database.OrderDirection, limit uint32, wantLen int) []string {
	t.Helper()

	page := database.Page[domain.SessionField]{
		Limit: limit,
		OrderBy: database.OrderBy[domain.SessionField]{
			Columns: []database.Column[domain.SessionField]{
				database.Col(domain.SessionFieldUserID),
				database.Col(domain.SessionFieldID),
			},
			Direction: direction,
		},
	}
	filter := database.Equal(database.Col(domain.SessionFieldProjectID), projectID)

	var got []string
	for pages := 0; ; pages++ {
		require.LessOrEqual(t, pages, wantLen, "paging did not terminate")
		result, err := stmts.ListSessions(t.Context(), &database.ListOptions[domain.SessionField]{
			Filter:     filter,
			Pagination: page,
		})
		require.NoError(t, err)
		for _, session := range result.Items {
			got = append(got, session.ID)
		}
		if len(result.NextCursor) == 0 {
			return got
		}
		page.Cursor = result.NextCursor
	}
}

// TestSessionStatements_List_PagesNullUserID pages a mix of anonymous and
// user-bound sessions sorted by the nullable user_id. Ascending is the issue
// 766 Postgres repro (NULLs ordered last lost the anonymous sessions);
// descending ends page one on a non-nil cursor, so the NULL block beyond it
// must still be reachable.
func TestSessionStatements_List_PagesNullUserID(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		want := make([]string, 0, 4)
		for range 2 {
			want = append(want, createAnonymousSession(t, d.stmts, projectID).ID)
		}
		for _, prefix := range []string{"usr-a-", "usr-b-"} {
			userID := prefix + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Paging User")))
			want = append(want, createUserBoundSession(t, d.stmts, projectID, userID).ID)
		}

		for name, direction := range map[string]database.OrderDirection{
			"asc":  database.OrderAsc,
			"desc": database.OrderDesc,
		} {
			t.Run(name, func(t *testing.T) {
				got := pageAllSessionIDs(t, d.stmts, projectID, direction, 2, len(want))
				assert.ElementsMatch(t, want, got, "every session must appear exactly once across all pages")
			})
		}
	})
}

// TestSessionStatements_List_NullBlockSpansPages forces the cursor to carry a
// NULL: three anonymous sessions with a page size of two put a page boundary
// inside the NULL block in both directions.
func TestSessionStatements_List_NullBlockSpansPages(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		want := make([]string, 0, 4)
		for range 3 {
			want = append(want, createAnonymousSession(t, d.stmts, projectID).ID)
		}
		userID := "usr-null-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Null Block User")))
		want = append(want, createUserBoundSession(t, d.stmts, projectID, userID).ID)

		for name, direction := range map[string]database.OrderDirection{
			"asc":  database.OrderAsc,
			"desc": database.OrderDesc,
		} {
			t.Run(name, func(t *testing.T) {
				got := pageAllSessionIDs(t, d.stmts, projectID, direction, 2, len(want))
				assert.ElementsMatch(t, want, got, "every session must appear exactly once across all pages")
			})
		}
	})
}
