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

// createTwoCheckSession exchanges an attempt with verified user and password
// factors, so the session carries two check rows.
func createTwoCheckSession(t *testing.T, stmts service.AllStatements, projectID, userID string) *domain.Session {
	t.Helper()
	plain, _ := handoffCompletedAttemptWithUser(t, stmts, projectID, userID)
	session, err := stmts.ExchangeSession(t.Context(), projectID, plain, nil, time.Hour)
	require.NoError(t, err)
	sessionID := session.ID
	t.Cleanup(func() {
		_ = stmts.DeleteSessionByID(context.Background(), projectID, sessionID)
	})
	return session
}

// TestSessionStatements_List_LimitBoundsSessions pages three sessions that
// carry two check rows each. The limit must bound sessions, not joined rows:
// a limit on joined rows shrinks the page and withholds the cursor, making
// the remaining sessions unreachable.
func TestSessionStatements_List_LimitBoundsSessions(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		userID := "usr-2fa-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Two Check User")))
		t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })
		want := make([]string, 0, 3)
		for range 3 {
			want = append(want, createTwoCheckSession(t, d.stmts, projectID, userID).ID)
		}
		slices.Sort(want)

		list := func(cursor []byte) *database.ListResult[*domain.Session] {
			result, err := d.stmts.ListSessions(t.Context(), &database.ListOptions[domain.SessionField]{
				Filter: database.Equal(database.Col(domain.SessionFieldProjectID), projectID),
				Pagination: database.Page[domain.SessionField]{
					Limit:  2,
					Cursor: cursor,
					OrderBy: database.OrderBy[domain.SessionField]{
						Columns: []database.Column[domain.SessionField]{database.Col(domain.SessionFieldID)},
					},
				},
			})
			require.NoError(t, err)
			return result
		}

		page1 := list(nil)
		require.Len(t, page1.Items, 2, "a full page must hold as many sessions as the limit")
		require.NotEmpty(t, page1.NextCursor, "a full page must issue a next cursor")

		page2 := list(page1.NextCursor)
		require.Len(t, page2.Items, 1)
		assert.Empty(t, page2.NextCursor)

		got := make([]string, 0, 3)
		for _, session := range append(page1.Items, page2.Items...) {
			assert.Len(t, session.Factors, 2, "session %s must keep its complete factor list", session.ID)
			got = append(got, session.ID)
		}
		// Exact order, not ElementsMatch: the ORDER BY after the joins is
		// otherwise unfenced.
		assert.Equal(t, want, got, "pages must return every session exactly once, in ID order")
	})
}

// TestSessionStatements_List_LimitKeepsFactorsComplete lists a two-check
// session with limit 1. A limit on joined rows would cut inside the session's
// check rows and truncate its factor list.
func TestSessionStatements_List_LimitKeepsFactorsComplete(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		userID := "usr-2fa-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Two Check User")))
		t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })
		created := createTwoCheckSession(t, d.stmts, projectID, userID)

		result, err := d.stmts.ListSessions(t.Context(), &database.ListOptions[domain.SessionField]{
			Filter:     database.Equal(database.Col(domain.SessionFieldProjectID), projectID),
			Pagination: database.Page[domain.SessionField]{Limit: 1},
		})
		require.NoError(t, err)
		require.Len(t, result.Items, 1)
		require.Equal(t, created.ID, result.Items[0].ID)

		gotTypes := make([]domain.AuthCheckType, 0, len(result.Items[0].Factors))
		for _, factor := range result.Items[0].Factors {
			gotTypes = append(gotTypes, factor.Type())
		}
		assert.ElementsMatch(t, []domain.AuthCheckType{domain.AuthCheckTypeUser, domain.AuthCheckTypePassword}, gotTypes,
			"the paged session must carry its complete factor list")
	})
}
