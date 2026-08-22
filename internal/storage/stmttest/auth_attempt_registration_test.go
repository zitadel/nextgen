//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func createBareAttempt(t *testing.T, stmts service.AllStatements, projectID string) *domain.AuthAttempt {
	t.Helper()
	attempt := &domain.AuthAttempt{ProjectID: projectID}
	require.NoError(t, stmts.CreateAuthAttempt(t.Context(), attempt))
	return attempt
}

func newRegistrationChallengePayload(userID string) *domain.PasskeyRegistrationChallenge {
	return &domain.PasskeyRegistrationChallenge{
		Challenge:   "test-challenge",
		RPID:        "example.com",
		UserID:      userID,
		Username:    "alice@example.com",
		DisplayName: "Alice Example",
		ExcludeIDs:  [][]byte{[]byte("cred-1")},
		Expires:     time.Now().Add(5 * time.Minute).UTC(),
	}
}

func TestAuthAttemptStatements_PasskeyRegistrationRoundTrip(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("challenge_payload_survives_the_round_trip", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			attempt := createBareAttempt(t, d.stmts, projectID)

			challenge := &domain.AuthChallengePasskeyRegistration{
				PasskeyRegistrationChallenge: newRegistrationChallengePayload("user_prov01"),
				Provisional:                  true,
			}
			require.NoError(t, d.stmts.SetAuthAttemptChallenge(t.Context(), projectID, attempt.ID, challenge))
			require.NotEmpty(t, challenge.GetID())

			got, err := d.stmts.GetAuthAttemptByID(t.Context(), projectID, attempt.ID)
			require.NoError(t, err)
			check, ok := got.ChallengeByType(domain.AuthCheckTypePasskeyRegistration)
			require.True(t, ok)
			decoded, ok := check.(*domain.AuthChallengePasskeyRegistration)
			require.True(t, ok)
			assert.Equal(t, challenge.GetID(), decoded.GetID())
			assert.True(t, decoded.Provisional)
			assert.Equal(t, "test-challenge", decoded.Challenge)
			assert.Equal(t, "user_prov01", decoded.UserID)
			assert.Equal(t, "alice@example.com", decoded.Username)
			assert.Equal(t, [][]byte{[]byte("cred-1")}, decoded.ExcludeIDs)
		})

		t.Run("succeeded_challenge_decodes_as_registration_factor", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			attempt := createBareAttempt(t, d.stmts, projectID)

			challenge := &domain.AuthChallengePasskeyRegistration{
				PasskeyRegistrationChallenge: newRegistrationChallengePayload("user_prov01"),
				Provisional:                  true,
			}
			require.NoError(t, d.stmts.SetAuthAttemptChallenge(t.Context(), projectID, attempt.ID, challenge))

			factor := &domain.AuthFactorPasskeyRegistration{
				UserID:         "user_prov01",
				CredentialID:   "cred-enc-1",
				UserVerified:   true,
				BackupEligible: true,
			}
			require.NoError(t, d.stmts.AuthAttemptChallengeSucceeded(t.Context(), projectID, attempt.ID, factor, challenge.GetID()))

			got, err := d.stmts.GetAuthAttemptByID(t.Context(), projectID, attempt.ID)
			require.NoError(t, err)
			gotFactor, ok := got.FactorByType(domain.AuthCheckTypePasskeyRegistration)
			require.True(t, ok)
			decoded, ok := gotFactor.(*domain.AuthFactorPasskeyRegistration)
			require.True(t, ok)
			assert.Equal(t, "user_prov01", decoded.UserID)
			assert.Equal(t, "cred-enc-1", decoded.CredentialID)
			assert.True(t, decoded.UserVerified)
			assert.True(t, decoded.BackupEligible)
			assert.False(t, decoded.GetLastVerifiedAt().IsZero())
			_, stillChallenged := got.ChallengeByType(domain.AuthCheckTypePasskeyRegistration)
			assert.False(t, stillChallenged)
		})
	})
}

func TestAuthAttemptStatements_SetAuthAttemptFactor(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("inserts_a_fresh_verified_factor", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			attempt := createBareAttempt(t, d.stmts, projectID)

			factor := &domain.AuthFactorUser{UserID: "user-1"}
			checkID, err := d.stmts.SetAuthAttemptFactor(t.Context(), projectID, attempt.ID, factor)
			require.NoError(t, err)
			assert.NotEmpty(t, checkID)
			assert.False(t, factor.GetLastVerifiedAt().IsZero())

			got, err := d.stmts.GetAuthAttemptByID(t.Context(), projectID, attempt.ID)
			require.NoError(t, err)
			gotFactor, ok := got.FactorByType(domain.AuthCheckTypeUser)
			require.True(t, ok)
			assert.Equal(t, "user-1", gotFactor.(*domain.AuthFactorUser).UserID)
		})

		t.Run("upsert_overwrites_and_clears_challenge_state", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			attempt := createBareAttempt(t, d.stmts, projectID)

			challenge := &domain.AuthChallengeUser{}
			require.NoError(t, d.stmts.SetAuthAttemptChallenge(t.Context(), projectID, attempt.ID, challenge))
			require.NoError(t, d.stmts.AuthAttemptChallengeFailed(t.Context(), projectID, attempt.ID, challenge))

			factor := &domain.AuthFactorUser{UserID: "user-2"}
			checkID, err := d.stmts.SetAuthAttemptFactor(t.Context(), projectID, attempt.ID, factor)
			require.NoError(t, err)
			assert.NotEmpty(t, checkID)

			got, err := d.stmts.GetAuthAttemptByID(t.Context(), projectID, attempt.ID)
			require.NoError(t, err)
			gotFactor, ok := got.FactorByType(domain.AuthCheckTypeUser)
			require.True(t, ok)
			assert.Equal(t, "user-2", gotFactor.(*domain.AuthFactorUser).UserID)
			// The pending challenge and its failure bookkeeping are gone.
			_, stillChallenged := got.ChallengeByType(domain.AuthCheckTypeUser)
			assert.False(t, stillChallenged)
		})
	})
}
