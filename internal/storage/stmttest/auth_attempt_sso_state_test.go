//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"encoding/base64"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// ssoTestCrypter stands in for the project's AES-GCM secret crypter. Its output
// is base64 like the real one's, so it survives the JSON payload column;
// crypto.InverseCrypter returns raw bytes that JSON marshalling would replace.
type ssoTestCrypter struct{}

func (ssoTestCrypter) Encrypt(plain string) (string, error) {
	return base64.StdEncoding.EncodeToString([]byte(plain)), nil
}

func (ssoTestCrypter) Decrypt(encrypted string) (string, error) {
	plain, err := base64.StdEncoding.DecodeString(encrypted)
	return string(plain), err
}

// issueSSOState mints a state and persists it on the attempt.
func issueSSOState(t *testing.T, stmts service.AllStatements, projectID, attemptID string) *domain.SSOState {
	t.Helper()
	sso, err := domain.NewSSOState("google", "idprev_1", "/after-login", ssoTestCrypter{})
	require.NoError(t, err)
	require.NoError(t, stmts.IssueSSOState(t.Context(), projectID, attemptID, sso.Check))
	return sso
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
			sso := issueSSOState(t, d.stmts, projectID, attempt.ID)

			// The row keeps a dialect-minted id (ADR 047); the state digest is
			// only the lookup key.
			assert.True(t, strings.HasPrefix(sso.Check.ID, "ch_"), "got id %q", sso.Check.ID)
			assert.Equal(t, domain.HashSecret(sso.State), sso.Check.StateHash)

			got, err := d.stmts.GetAuthAttemptByID(t.Context(), projectID, attempt.ID)
			require.NoError(t, err)
			stored, ok := got.SSOCallback()
			require.True(t, ok)
			assert.Equal(t, sso.Check.ID, stored.ID)
			assert.Empty(t, stored.StateHash, "an attempt read never carries the lookup key")
			assert.Equal(t, sso.Check.Pending, stored.Pending)
			assert.Nil(t, stored.Result)
			assert.False(t, stored.IssuedAt.IsZero())

			// The column holds the ciphertext, and it decrypts back to the
			// plaintext the constructor handed the caller.
			assert.Equal(t, sso.Check.Pending.EncryptedPKCEVerifier, stored.Pending.EncryptedPKCEVerifier)
			assert.NotEqual(t, sso.PKCEVerifier, stored.Pending.EncryptedPKCEVerifier)
			verifier, err := stored.Pending.DecryptPKCEVerifier(ssoTestCrypter{})
			require.NoError(t, err)
			assert.Equal(t, sso.PKCEVerifier, verifier)

			// The binding nonce survives as a hash the callback can verify
			// against the browser's cookie.
			assert.Equal(t, domain.HashSecret(sso.BindingNonce), stored.Pending.BindingNonceHash)
			assert.NotEqual(t, sso.BindingNonce, stored.Pending.BindingNonceHash)
			assert.True(t, stored.Pending.MatchesBindingNonce(sso.BindingNonce))
		})

		t.Run("consume_returns_payload_once", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			// A bare attempt carries no TTL, so nothing can expire: the
			// consume has to treat that as alive, not as expired.
			attempt := createBareAttempt(t, d.stmts, projectID)
			require.Nil(t, attempt.TimeToLive)
			sso := issueSSOState(t, d.stmts, projectID, attempt.ID)
			stateHash := domain.HashSecret(sso.State)

			consumed, err := d.stmts.ConsumeSSOState(t.Context(), projectID, stateHash)
			require.NoError(t, err)
			assert.Equal(t, sso.Check.ID, consumed.ID)
			assert.Equal(t, stateHash, consumed.StateHash)
			assert.Equal(t, attempt.ID, consumed.AuthAttemptID)
			assert.Equal(t, sso.Check.Pending, consumed.Pending)

			// The consume hands the callback the verifier it needs for the
			// code exchange, still only as ciphertext on the record.
			verifier, err := consumed.Pending.DecryptPKCEVerifier(ssoTestCrypter{})
			require.NoError(t, err)
			assert.Equal(t, sso.PKCEVerifier, verifier)

			_, err = d.stmts.ConsumeSSOState(t.Context(), projectID, stateHash)
			assert.ErrorIs(t, err, domain.ErrSSOStateInvalid())

			got, err := d.stmts.GetAuthAttemptByID(t.Context(), projectID, attempt.ID)
			require.NoError(t, err)
			stored, ok := got.SSOCallback()
			require.True(t, ok)
			assert.Nil(t, stored.Pending)
			assert.True(t, stored.IssuedAt.IsZero())
		})

		// An expired ceremony must not be told apart from an unknown state, and
		// the row goes either way: a caller that retries finds nothing left.
		t.Run("expired_attempt_is_burned_and_rejected", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			ttl := time.Nanosecond
			attempt := &domain.AuthAttempt{ProjectID: projectID, TimeToLive: &ttl}
			require.NoError(t, d.stmts.CreateAuthAttempt(t.Context(), attempt))
			sso := issueSSOState(t, d.stmts, projectID, attempt.ID)
			stateHash := domain.HashSecret(sso.State)

			_, err := d.stmts.ConsumeSSOState(t.Context(), projectID, stateHash)
			assert.ErrorIs(t, err, domain.ErrSSOStateInvalid())

			_, err = d.stmts.ConsumeSSOState(t.Context(), projectID, stateHash)
			assert.ErrorIs(t, err, domain.ErrSSOStateInvalid())

			got, err := d.stmts.GetAuthAttemptByID(t.Context(), projectID, attempt.ID)
			require.NoError(t, err)
			stored, ok := got.SSOCallback()
			require.True(t, ok)
			assert.Nil(t, stored.Pending, "the expired state is burned, not left pending")
		})

		t.Run("unknown_hash_same_sentinel", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			_, err := d.stmts.ConsumeSSOState(t.Context(), projectID, domain.HashSecret("never-issued"))
			assert.ErrorIs(t, err, domain.ErrSSOStateInvalid())
		})

		// A re-issue mints a fresh row id, so a check id captured before it can
		// never name the new ceremony.
		t.Run("reissue_rotates_the_check_id", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			attempt := createBareAttempt(t, d.stmts, projectID)
			first := issueSSOState(t, d.stmts, projectID, attempt.ID)
			second := issueSSOState(t, d.stmts, projectID, attempt.ID)

			assert.NotEqual(t, first.Check.ID, second.Check.ID)
			assert.True(t, strings.HasPrefix(second.Check.ID, "ch_"), "got id %q", second.Check.ID)

			got, err := d.stmts.GetAuthAttemptByID(t.Context(), projectID, attempt.ID)
			require.NoError(t, err)
			stored, ok := got.SSOCallback()
			require.True(t, ok)
			assert.Equal(t, second.Check.ID, stored.ID)
		})

		t.Run("consume_after_reissue_fails", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			attempt := createBareAttempt(t, d.stmts, projectID)
			first := issueSSOState(t, d.stmts, projectID, attempt.ID)
			second := issueSSOState(t, d.stmts, projectID, attempt.ID)

			_, err := d.stmts.ConsumeSSOState(t.Context(), projectID, domain.HashSecret(first.State))
			assert.ErrorIs(t, err, domain.ErrSSOStateInvalid())

			consumed, err := d.stmts.ConsumeSSOState(t.Context(), projectID, domain.HashSecret(second.State))
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
			sso := issueSSOState(t, d.stmts, projectID, attempt.ID)
			stateHash := domain.HashSecret(sso.State)

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
			sso := issueSSOState(t, d.stmts, projectID, attempt.ID)
			stateHash := domain.HashSecret(sso.State)
			_, err := d.stmts.ConsumeSSOState(t.Context(), projectID, stateHash)
			require.NoError(t, err)
			require.NoError(t, d.stmts.SetSSOCallbackResult(t.Context(), projectID, stateHash,
				&domain.SSOCallbackResult{Subject: "sub-1"}))

			reissued := issueSSOState(t, d.stmts, projectID, attempt.ID)

			got, err := d.stmts.GetAuthAttemptByID(t.Context(), projectID, attempt.ID)
			require.NoError(t, err)
			stored, ok := got.SSOCallback()
			require.True(t, ok)
			assert.Nil(t, stored.Result, "a re-issue must never leave an earlier identity readable")
			assert.Equal(t, reissued.Check.Pending, stored.Pending)

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

			first := issueSSOState(t, d.stmts, projectID, attempt.ID)
			_, err := d.stmts.ConsumeSSOState(t.Context(), projectID, domain.HashSecret(first.State))
			require.NoError(t, err)

			second := issueSSOState(t, d.stmts, projectID, attempt.ID)
			_, err = d.stmts.ConsumeSSOState(t.Context(), projectID, domain.HashSecret(second.State))
			require.NoError(t, err)

			err = d.stmts.SetSSOCallbackResult(t.Context(), projectID, domain.HashSecret(first.State),
				&domain.SSOCallbackResult{Subject: "stale-sub"})
			assert.ErrorIs(t, err, domain.ErrSSOStateInvalid())

			require.NoError(t, d.stmts.SetSSOCallbackResult(t.Context(), projectID, domain.HashSecret(second.State),
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
			sso := issueSSOState(t, d.stmts, projectID, attempt.ID)
			stateHash := domain.HashSecret(sso.State)

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
			sso := issueSSOState(t, d.stmts, projectID, attempt.ID)
			stateHash := domain.HashSecret(sso.State)
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
			pending := issueSSOState(t, d.stmts, projectID, pendingAttempt.ID)
			_, err = d.stmts.ExchangeSession(t.Context(), projectID, pendingToken, nil, time.Hour)
			require.NoError(t, err)

			_, err = d.stmts.ConsumeSSOState(t.Context(), projectID, domain.HashSecret(pending.State))
			assert.ErrorIs(t, err, domain.ErrSSOStateInvalid())
			_, err = d.stmts.GetAuthAttemptByID(t.Context(), projectID, pendingAttempt.ID)
			assert.ErrorIs(t, err, domain.ErrAuthAttemptNotFound())
		})
	})
}
