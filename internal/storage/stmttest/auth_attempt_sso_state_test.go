//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// issueSSOState mints a state and persists it on the attempt, returning the
// plaintext state and the minted record.
func issueSSOState(t *testing.T, stmts service.AllStatements, projectID, attemptID string) (string, *domain.SSOCallbackCheck) {
	t.Helper()
	state, check, err := domain.NewSSOState("google", "idprev_1", "/after-login", true)
	require.NoError(t, err)
	require.NoError(t, stmts.IssueSSOState(t.Context(), projectID, attemptID, check))
	return state, check
}

// TestAuthAttemptStatements_SSOState covers the single-use state record that
// bridges the social-login submit step and the provider callback: it is found
// by the state hash alone, burns exactly once, carries its result without ever
// becoming a verified factor, and dies with its attempt.
func TestAuthAttemptStatements_SSOState(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("issue_round_trip", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			attempt := createBareAttempt(t, d.stmts, projectID)
			state, check := issueSSOState(t, d.stmts, projectID, attempt.ID)

			got, err := d.stmts.GetAuthAttemptByID(t.Context(), projectID, attempt.ID)
			require.NoError(t, err)
			stored, ok := got.SSOCallback()
			require.True(t, ok)
			assert.Equal(t, domain.HashSecret(state), stored.ID)
			assert.Equal(t, check.Pending, stored.Pending)
			assert.Nil(t, stored.Result)
			assert.False(t, stored.IssuedAt.IsZero())
		})

		t.Run("consume_returns_payload_once", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			attempt := createBareAttempt(t, d.stmts, projectID)
			state, check := issueSSOState(t, d.stmts, projectID, attempt.ID)
			stateHash := domain.HashSecret(state)

			consumed, err := d.stmts.ConsumeSSOState(t.Context(), projectID, stateHash)
			require.NoError(t, err)
			assert.Equal(t, stateHash, consumed.ID)
			assert.Equal(t, attempt.ID, consumed.AuthAttemptID)
			assert.Equal(t, check.Pending, consumed.Pending)

			_, err = d.stmts.ConsumeSSOState(t.Context(), projectID, stateHash)
			assert.ErrorIs(t, err, domain.ErrSSOStateInvalid())

			got, err := d.stmts.GetAuthAttemptByID(t.Context(), projectID, attempt.ID)
			require.NoError(t, err)
			stored, ok := got.SSOCallback()
			require.True(t, ok)
			assert.Nil(t, stored.Pending)
			assert.True(t, stored.IssuedAt.IsZero())
		})

		t.Run("unknown_hash_same_sentinel", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			_, err := d.stmts.ConsumeSSOState(t.Context(), projectID, domain.HashSecret("never-issued"))
			assert.ErrorIs(t, err, domain.ErrSSOStateInvalid())
		})

		t.Run("consume_after_reissue_fails", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			attempt := createBareAttempt(t, d.stmts, projectID)
			firstState, _ := issueSSOState(t, d.stmts, projectID, attempt.ID)
			secondState, _ := issueSSOState(t, d.stmts, projectID, attempt.ID)

			_, err := d.stmts.ConsumeSSOState(t.Context(), projectID, domain.HashSecret(firstState))
			assert.ErrorIs(t, err, domain.ErrSSOStateInvalid())

			consumed, err := d.stmts.ConsumeSSOState(t.Context(), projectID, domain.HashSecret(secondState))
			require.NoError(t, err)
			assert.Equal(t, attempt.ID, consumed.AuthAttemptID)
		})

		t.Run("result_visible_after_set", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			attempt := &domain.AuthAttempt{
				ProjectID:      projectID,
				RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
			}
			require.NoError(t, d.stmts.CreateAuthAttempt(t.Context(), attempt))
			state, _ := issueSSOState(t, d.stmts, projectID, attempt.ID)
			stateHash := domain.HashSecret(state)

			_, err := d.stmts.ConsumeSSOState(t.Context(), projectID, stateHash)
			require.NoError(t, err)
			result := &domain.SSOCallbackResult{
				Subject:              "sub-1",
				ConnectionRevisionID: "idprev_1",
				Claims:               map[string]any{"email": "alice@example.com"},
			}
			require.NoError(t, d.stmts.SetSSOCallbackResult(t.Context(), projectID, stateHash, result))

			got, err := d.stmts.GetAuthAttemptByID(t.Context(), projectID, attempt.ID)
			require.NoError(t, err)
			stored, ok := got.SSOCallback()
			require.True(t, ok)
			require.NotNil(t, stored.Result)
			assert.Equal(t, "sub-1", stored.Result.Subject)
			assert.Equal(t, "alice@example.com", stored.Result.Claims["email"])
			assert.Nil(t, stored.Pending)

			// A stored result is not a verified factor, so the required
			// password check is still unmet.
			_, isFactor := got.FactorByType(domain.AuthCheckTypeSSOCallback)
			assert.False(t, isFactor)
			assert.False(t, got.IsCompleted())
		})

		t.Run("reissue_clears_result", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			attempt := createBareAttempt(t, d.stmts, projectID)
			state, _ := issueSSOState(t, d.stmts, projectID, attempt.ID)
			stateHash := domain.HashSecret(state)
			_, err := d.stmts.ConsumeSSOState(t.Context(), projectID, stateHash)
			require.NoError(t, err)
			require.NoError(t, d.stmts.SetSSOCallbackResult(t.Context(), projectID, stateHash,
				&domain.SSOCallbackResult{Subject: "sub-1"}))

			_, reissued := issueSSOState(t, d.stmts, projectID, attempt.ID)

			got, err := d.stmts.GetAuthAttemptByID(t.Context(), projectID, attempt.ID)
			require.NoError(t, err)
			stored, ok := got.SSOCallback()
			require.True(t, ok)
			assert.Nil(t, stored.Result, "a re-issue must never leave an earlier identity readable")
			assert.Equal(t, reissued.Pending, stored.Pending)

			// The re-issue rotated the row id, so the earlier ceremony's hash
			// no longer names a consumed row.
			err = d.stmts.SetSSOCallbackResult(t.Context(), projectID, stateHash,
				&domain.SSOCallbackResult{Subject: "sub-2"})
			assert.ErrorIs(t, err, domain.ErrSSOStateInvalid())
		})

		t.Run("set_result_without_issue_fails", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			err := d.stmts.SetSSOCallbackResult(t.Context(), projectID, domain.HashSecret("never-issued"),
				&domain.SSOCallbackResult{Subject: "sub-1"})
			assert.ErrorIs(t, err, domain.ErrSSOStateInvalid())
		})

		// Two tabs overlap: tab 1 consumes s1 and is still exchanging its code
		// while tab 2 re-issues s2 and its callback consumes s2. Tab 1's late
		// result must not land on tab 2's ceremony, so the write is keyed by
		// the hash it consumed, not by the attempt.
		t.Run("stale_result_after_reissue_and_consume_fails", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			attempt := createBareAttempt(t, d.stmts, projectID)

			firstState, _ := issueSSOState(t, d.stmts, projectID, attempt.ID)
			_, err := d.stmts.ConsumeSSOState(t.Context(), projectID, domain.HashSecret(firstState))
			require.NoError(t, err)

			secondState, _ := issueSSOState(t, d.stmts, projectID, attempt.ID)
			_, err = d.stmts.ConsumeSSOState(t.Context(), projectID, domain.HashSecret(secondState))
			require.NoError(t, err)

			err = d.stmts.SetSSOCallbackResult(t.Context(), projectID, domain.HashSecret(firstState),
				&domain.SSOCallbackResult{Subject: "stale-sub"})
			assert.ErrorIs(t, err, domain.ErrSSOStateInvalid())

			require.NoError(t, d.stmts.SetSSOCallbackResult(t.Context(), projectID, domain.HashSecret(secondState),
				&domain.SSOCallbackResult{Subject: "fresh-sub"}))

			got, err := d.stmts.GetAuthAttemptByID(t.Context(), projectID, attempt.ID)
			require.NoError(t, err)
			stored, ok := got.SSOCallback()
			require.True(t, ok)
			require.NotNil(t, stored.Result)
			assert.Equal(t, "fresh-sub", stored.Result.Subject)
		})

		t.Run("concurrent_consume_exactly_one_wins", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			attempt := createBareAttempt(t, d.stmts, projectID)
			state, _ := issueSSOState(t, d.stmts, projectID, attempt.ID)
			stateHash := domain.HashSecret(state)

			var (
				wg      sync.WaitGroup
				results [2]*domain.SSOCallbackCheck
				errs    [2]error
			)
			start := make(chan struct{})
			for i := range results {
				wg.Go(func() {
					<-start // release together so the two consumes genuinely overlap
					results[i], errs[i] = d.stmts.ConsumeSSOState(t.Context(), projectID, stateHash)
				})
			}
			close(start)
			wg.Wait()

			var won int
			for i := range results {
				if errs[i] == nil {
					won++
					require.NotNil(t, results[i])
					assert.Equal(t, attempt.ID, results[i].AuthAttemptID)
					continue
				}
				assert.ErrorIs(t, errs[i], domain.ErrSSOStateInvalid(), "consumer %d", i)
			}
			assert.Equal(t, 1, won, "a state burns exactly once")
		})

		t.Run("exchange_promotes_nothing_and_cascades", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			token, attempt := handoffCompletedAttempt(t, d.stmts, projectID, nil)
			state, _ := issueSSOState(t, d.stmts, projectID, attempt.ID)
			stateHash := domain.HashSecret(state)
			_, err := d.stmts.ConsumeSSOState(t.Context(), projectID, stateHash)
			require.NoError(t, err)
			require.NoError(t, d.stmts.SetSSOCallbackResult(t.Context(), projectID, stateHash,
				&domain.SSOCallbackResult{Subject: "sub-1"}))

			sess, err := d.stmts.ExchangeSession(t.Context(), projectID, token, nil, time.Hour)
			require.NoError(t, err)
			require.Len(t, sess.Factors, 1, "only the password factor is promoted")
			assert.Equal(t, domain.AuthCheckTypePassword, sess.Factors[0].Type())

			// A pending state dies with its attempt: the exchange deletes the
			// attempt and the row cascades with it.
			pendingToken, pendingAttempt := handoffCompletedAttempt(t, d.stmts, projectID, nil)
			pendingState, _ := issueSSOState(t, d.stmts, projectID, pendingAttempt.ID)
			_, err = d.stmts.ExchangeSession(t.Context(), projectID, pendingToken, nil, time.Hour)
			require.NoError(t, err)

			_, err = d.stmts.ConsumeSSOState(t.Context(), projectID, domain.HashSecret(pendingState))
			assert.ErrorIs(t, err, domain.ErrSSOStateInvalid())
			_, err = d.stmts.GetAuthAttemptByID(t.Context(), projectID, pendingAttempt.ID)
			assert.ErrorIs(t, err, domain.ErrAuthAttemptNotFound())
		})
	})
}
