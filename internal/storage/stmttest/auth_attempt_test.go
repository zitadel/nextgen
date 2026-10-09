//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"crypto/sha256"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/zitadel/v5/internal/domain"
	"github.com/zitadel/zitadel/v5/internal/storage/database"
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

// Two requests that both saw the attempt not handed off must not both mint a
// token: the later write would replace the token the earlier one returned.
func TestAuthAttemptStatements_HandoffRefusesSecond(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		_, attempt := handoffCompletedAttempt(t, d.stmts, projectID, nil)
		first := attempt.HandoffToken.TokenHash

		second := sha256.Sum256([]byte("handoff_second"))
		again := &domain.AuthAttempt{ProjectID: projectID, ID: attempt.ID, HandoffToken: &domain.HandoffToken{TokenHash: second[:]}}
		require.ErrorIs(t, d.stmts.HandoffAuthAttempt(t.Context(), again), domain.ErrAuthAttemptAlreadyHandedOff())

		got, err := d.stmts.GetAuthAttemptByID(t.Context(), projectID, attempt.ID)
		require.NoError(t, err)
		require.NotNil(t, got.HandoffToken)
		assert.Equal(t, first, got.HandoffToken.TokenHash, "the first token stays")
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

func TestAuthAttemptStatements_SetSSOFactorRoundTrip(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		attempt := createBareAttempt(t, d.stmts, projectID)

		_, err := d.stmts.SetAuthAttemptFactor(t.Context(), projectID, attempt.ID,
			&domain.AuthFactorSSO{ConnectionID: "idp_1", LinkID: "idplink_1", AttemptID: attempt.ID})
		require.NoError(t, err)

		got, err := d.stmts.GetAuthAttemptByID(t.Context(), projectID, attempt.ID)
		require.NoError(t, err)
		factor, ok := domain.CheckAs[*domain.AuthFactorSSO](got, domain.AuthCheckTypeSSO)
		require.True(t, ok)
		assert.Equal(t, "idp_1", factor.ConnectionID)
		assert.Equal(t, "idplink_1", factor.LinkID)
		assert.Equal(t, attempt.ID, factor.AttemptID)
		assert.False(t, factor.GetLastVerifiedAt().IsZero())
	})
}
