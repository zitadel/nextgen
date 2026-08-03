//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"crypto/sha256"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestAuthAttemptStatements_Handoff(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("sets handed_off_at on success", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			_, attempt := handoffCompletedAttempt(t, d.stmts, projectID, nil)
			require.NotNil(t, attempt.HandedOffAt)
			assert.False(t, attempt.HandedOffAt.IsZero())
		})

		t.Run("missing attempt returns NoRowFoundError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			err := d.stmts.HandoffAuthAttempt(t.Context(), newMissingHandoffAttempt(projectID))
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})
	})
}

func TestAuthAttemptStatements_Get(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("by_id_returns_handed_off_attempt", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			_, attempt := handoffCompletedAttempt(t, d.stmts, projectID, nil)

			got, err := d.stmts.GetAuthAttemptByID(t.Context(), projectID, attempt.ID)
			require.NoError(t, err)
			assert.Equal(t, attempt.ID, got.ID)
			assert.Equal(t, projectID, got.ProjectID)
			require.NotNil(t, got.HandoffToken)
			assert.Equal(t, attempt.HandoffToken.TokenHash, got.HandoffToken.TokenHash)
			require.NotNil(t, got.HandedOffAt)
			assert.False(t, got.HandedOffAt.IsZero())
		})

		t.Run("by_handoff_token_returns_same_attempt", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			plain, attempt := handoffCompletedAttempt(t, d.stmts, projectID, nil)
			sum := sha256.Sum256([]byte(plain))

			got, err := d.stmts.GetAuthAttemptByHandoffToken(t.Context(), projectID, sum[:])
			require.NoError(t, err)
			assert.Equal(t, attempt.ID, got.ID)
			require.NotNil(t, got.HandoffToken)
			assert.Equal(t, attempt.HandoffToken.TokenHash, got.HandoffToken.TokenHash)
		})

		t.Run("missing_id_returns_not_found", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			_, err := d.stmts.GetAuthAttemptByID(t.Context(), projectID, "999999999")
			assert.ErrorIs(t, err, domain.ErrAuthAttemptNotFound())
		})

		t.Run("unknown_handoff_token_returns_not_found", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			sum := sha256.Sum256([]byte("unknown-handoff-" + uniqueSuffix(t)))
			_, err := d.stmts.GetAuthAttemptByHandoffToken(t.Context(), projectID, sum[:])
			assert.ErrorIs(t, err, domain.ErrAuthAttemptNotFound())
		})
	})
}
