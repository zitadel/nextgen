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

func TestSessionStatements_RevokeSoftDeletes(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		sess, err := domain.NewSession(projectID, nil)
		require.NoError(t, err)
		require.NoError(t, d.stmts.CreateSession(t.Context(), sess))
		require.NotEmpty(t, sess.ID)
		t.Cleanup(func() {
			_ = d.stmts.DeleteSessionByID(context.Background(), projectID, sess.ID)
		})

		// Revoke soft-deletes: the row stays and revoked_at is stamped.
		require.NoError(t, d.stmts.RevokeSessionByID(t.Context(), projectID, sess.ID))

		got, err := d.stmts.GetSessionByID(t.Context(), projectID, sess.ID)
		require.NoError(t, err, "a revoked session must remain readable, not be deleted")
		require.NotNil(t, got.RevokedAt, "revoked_at must be persisted")
		assert.Equal(t, domain.SessionStateRevoked, got.State())

		// The revoked_at IS NULL guard makes a second revoke a no-op at storage:
		// it reports NotFound so the service can treat revoke as idempotent.
		err = d.stmts.RevokeSessionByID(t.Context(), projectID, sess.ID)
		assert.ErrorIs(t, err, domain.ErrSessionNotFound(), "re-revoking an already-revoked session is a no-op")

		// Revoking a session that does not exist reports NotFound too.
		err = d.stmts.RevokeSessionByID(t.Context(), projectID, "sess_missing")
		assert.ErrorIs(t, err, domain.ErrSessionNotFound())
	})
}
