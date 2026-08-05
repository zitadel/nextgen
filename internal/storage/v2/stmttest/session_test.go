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

// TestSessionStatements_ExchangeUpgradesShellInPlace covers the #755 lifecycle:
// a login persists a building shell, its auth-attempt links to that shell, and
// exchange upgrades the same row (building -> active) instead of creating a
// second session.
func TestSessionStatements_ExchangeUpgradesShellInPlace(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		user := newTestUser(t, projectID, schemaURL, "user-upgrade-"+uniqueSuffix(t), "upgrade@example.com", "Upgrade User")
		require.NoError(t, d.stmts.CreateUser(t.Context(), user))

		// The building shell persisted when the login started.
		shell, err := domain.NewSession(projectID, nil)
		require.NoError(t, err)
		require.NoError(t, d.stmts.CreateSession(t.Context(), shell))
		require.NotEmpty(t, shell.ID)
		require.Equal(t, domain.SessionStateBuilding, shell.State())
		shellID := shell.ID
		t.Cleanup(func() {
			_ = d.stmts.DeleteSessionByID(context.Background(), projectID, shellID)
		})

		// The login's auth-attempt links to that shell.
		plain, _ := handoffCompletedAttempt(t, d.stmts, projectID, func(a *domain.AuthAttempt) {
			a.SessionID = &shellID
			a.RequiredChecks = []domain.AuthCheckType{domain.AuthCheckTypeUser, domain.AuthCheckTypePassword}
			a.Checks = []domain.AuthCheck{
				&domain.AuthFactorUser{UserID: user.ID},
				&domain.AuthFactorPassword{},
			}
		})

		exchanged, err := d.stmts.ExchangeSession(t.Context(), projectID, plain, nil, time.Hour)
		require.NoError(t, err)
		// Same session, upgraded in place: no duplicate id.
		require.Equal(t, shellID, exchanged.ID, "exchange must upgrade the shell, not mint a new session")
		require.NotNil(t, exchanged.UserID)
		assert.Equal(t, user.ID, *exchanged.UserID)
		assert.Equal(t, domain.SessionStateActive, exchanged.State())

		got, err := d.stmts.GetSessionByID(t.Context(), projectID, shellID)
		require.NoError(t, err)
		assert.Equal(t, domain.SessionStateActive, got.State())
		assert.NotEmpty(t, got.Factors, "verified factors promoted onto the upgraded session")
	})
}
