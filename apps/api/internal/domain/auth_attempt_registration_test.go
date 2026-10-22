package domain_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestAuthAttempt_PreparePasskeyRegistrationChallenge(t *testing.T) {
	t.Run("no user factor is provisional", func(t *testing.T) {
		attempt := &domain.AuthAttempt{ProjectID: "proj", ID: "att-1"}

		userID, provisional, err := attempt.PreparePasskeyRegistrationChallenge("")
		require.NoError(t, err)
		assert.True(t, provisional)
		assert.Empty(t, userID)
	})

	t.Run("no user factor honors requested handle on re-issue", func(t *testing.T) {
		attempt := &domain.AuthAttempt{ProjectID: "proj", ID: "att-1"}

		userID, provisional, err := attempt.PreparePasskeyRegistrationChallenge("user_minted01")
		require.NoError(t, err)
		assert.True(t, provisional)
		assert.Equal(t, "user_minted01", userID)
	})

	t.Run("pinned user factor targets that user", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			ProjectID: "proj", ID: "att-1",
			Checks: []domain.AuthCheck{&domain.AuthFactorUser{UserID: "user-1"}},
		}

		userID, provisional, err := attempt.PreparePasskeyRegistrationChallenge("")
		require.NoError(t, err)
		assert.False(t, provisional)
		assert.Equal(t, "user-1", userID)

		userID, provisional, err = attempt.PreparePasskeyRegistrationChallenge("user-1")
		require.NoError(t, err)
		assert.False(t, provisional)
		assert.Equal(t, "user-1", userID)
	})

	t.Run("pinned user factor rejects a different requested user", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			ProjectID: "proj", ID: "att-1",
			Checks: []domain.AuthCheck{&domain.AuthFactorUser{UserID: "user-1"}},
		}

		_, _, err := attempt.PreparePasskeyRegistrationChallenge("user-2")
		assert.ErrorIs(t, err, domain.ErrAuthAttemptInvalidRequest())
	})

	t.Run("handed off attempt is rejected", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			ProjectID: "proj", ID: "att-1",
			HandoffToken: &domain.HandoffToken{TokenHash: []byte("hash")},
		}

		_, _, err := attempt.PreparePasskeyRegistrationChallenge("")
		assert.ErrorIs(t, err, domain.ErrAuthAttemptAlreadyHandedOff())
	})

	t.Run("expired attempt is rejected", func(t *testing.T) {
		ttl := domain.AuthAttemptTTL
		attempt := &domain.AuthAttempt{
			ProjectID: "proj", ID: "att-1",
			CreatedAt:  time.Now().Add(-ttl - time.Minute),
			TimeToLive: &ttl,
		}

		_, _, err := attempt.PreparePasskeyRegistrationChallenge("")
		assert.ErrorIs(t, err, domain.ErrAuthAttemptInvalidState())
	})
}

func TestAuthAttempt_HasProvisionalRegistrationHandle(t *testing.T) {
	newChallenge := func(userID string, provisional bool) *domain.AuthChallengePasskeyRegistration {
		challenge := domain.SetAuthChallengePasskeyRegistration("ch-reg-1", time.Now(), time.Time{}, 0)
		challenge.UserID = userID
		challenge.Provisional = provisional
		return challenge
	}

	t.Run("matches the in-flight provisional handle", func(t *testing.T) {
		attempt := &domain.AuthAttempt{Checks: []domain.AuthCheck{newChallenge("user_minted01", true)}}
		assert.True(t, attempt.HasProvisionalRegistrationHandle("user_minted01"))
	})

	t.Run("rejects a different handle", func(t *testing.T) {
		attempt := &domain.AuthAttempt{Checks: []domain.AuthCheck{newChallenge("user_minted01", true)}}
		assert.False(t, attempt.HasProvisionalRegistrationHandle("user_other"))
	})

	t.Run("rejects a non-provisional ceremony's handle", func(t *testing.T) {
		attempt := &domain.AuthAttempt{Checks: []domain.AuthCheck{newChallenge("user-1", false)}}
		assert.False(t, attempt.HasProvisionalRegistrationHandle("user-1"))
	})

	t.Run("rejects when no registration challenge exists", func(t *testing.T) {
		attempt := &domain.AuthAttempt{}
		assert.False(t, attempt.HasProvisionalRegistrationHandle("user_minted01"))
	})
}

func TestAuthAttempt_PreparePasskeyRegistrationVerification(t *testing.T) {
	newRegistrationAttempt := func(challengedAt time.Time) (*domain.AuthAttempt, *domain.AuthChallengePasskeyRegistration) {
		challenge := domain.SetAuthChallengePasskeyRegistration("ch-reg-1", challengedAt, time.Time{}, 0)
		challenge.UserID = "user-1"
		attempt := &domain.AuthAttempt{
			ProjectID: "proj", ID: "att-1",
			Checks: []domain.AuthCheck{challenge},
		}
		return attempt, challenge
	}

	t.Run("returns the current challenge", func(t *testing.T) {
		attempt, challenge := newRegistrationAttempt(time.Now())

		got, err := attempt.PreparePasskeyRegistrationVerification("ch-reg-1")
		require.NoError(t, err)
		assert.Same(t, challenge, got)
	})

	t.Run("challenge older than the ceremony TTL is stale", func(t *testing.T) {
		attempt, _ := newRegistrationAttempt(time.Now().Add(-domain.PasskeyRegistrationChallengeTTL - time.Minute))

		_, err := attempt.PreparePasskeyRegistrationVerification("ch-reg-1")
		assert.ErrorIs(t, err, domain.ErrAuthAttemptStaleChallenge())
	})

	t.Run("unknown challenge id is stale", func(t *testing.T) {
		attempt, _ := newRegistrationAttempt(time.Now())

		_, err := attempt.PreparePasskeyRegistrationVerification("ch-other")
		assert.ErrorIs(t, err, domain.ErrAuthAttemptStaleChallenge())
	})

	t.Run("challenge of another type is rejected", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			ProjectID: "proj", ID: "att-1",
			Checks: []domain.AuthCheck{domain.SetAuthChallengePassword("ch-pw-1", time.Now(), time.Time{}, 0)},
		}

		_, err := attempt.PreparePasskeyRegistrationVerification("ch-pw-1")
		assert.ErrorIs(t, err, domain.ErrAuthAttemptInvalidRequest())
	})

	t.Run("provisional ceremony is superseded by a later authentication", func(t *testing.T) {
		// Issue provisional, then authenticate user A on the same attempt:
		// completing the ceremony would create a second user and overwrite
		// A's user check while A's other factors survive.
		challenge := domain.SetAuthChallengePasskeyRegistration("ch-reg-1", time.Now(), time.Time{}, 0)
		challenge.UserID = "user_prov01"
		challenge.Provisional = true
		attempt := &domain.AuthAttempt{
			ProjectID: "proj", ID: "att-1",
			Checks: []domain.AuthCheck{
				challenge,
				&domain.AuthFactorUser{UserID: "user-a"},
				&domain.AuthFactorPassword{},
			},
		}

		_, err := attempt.PreparePasskeyRegistrationVerification("ch-reg-1")
		assert.ErrorIs(t, err, domain.ErrAuthAttemptStaleChallenge())
	})

	t.Run("pinned user changing after issue supersedes the ceremony", func(t *testing.T) {
		challenge := domain.SetAuthChallengePasskeyRegistration("ch-reg-1", time.Now(), time.Time{}, 0)
		challenge.UserID = "user-a"
		challenge.Provisional = false
		attempt := &domain.AuthAttempt{
			ProjectID: "proj", ID: "att-1",
			Checks: []domain.AuthCheck{
				challenge,
				&domain.AuthFactorUser{UserID: "user-b"},
			},
		}

		_, err := attempt.PreparePasskeyRegistrationVerification("ch-reg-1")
		assert.ErrorIs(t, err, domain.ErrAuthAttemptStaleChallenge())
	})

	t.Run("matching pinned user stays valid", func(t *testing.T) {
		challenge := domain.SetAuthChallengePasskeyRegistration("ch-reg-1", time.Now(), time.Time{}, 0)
		challenge.UserID = "user-a"
		challenge.Provisional = false
		attempt := &domain.AuthAttempt{
			ProjectID: "proj", ID: "att-1",
			Checks: []domain.AuthCheck{
				challenge,
				&domain.AuthFactorUser{UserID: "user-a"},
			},
		}

		got, err := attempt.PreparePasskeyRegistrationVerification("ch-reg-1")
		require.NoError(t, err)
		assert.Same(t, challenge, got)
	})
}

func TestAuthCheckType_Class(t *testing.T) {
	assert.Equal(t, domain.AuthCheckTypePasskey, domain.AuthCheckTypePasskeyRegistration.Class())
	assert.Equal(t, domain.AuthCheckTypePasskey, domain.AuthCheckTypePasskey.Class())
	assert.Equal(t, domain.AuthCheckTypeUser, domain.AuthCheckTypeUser.Class())
	assert.Equal(t, domain.AuthCheckTypePassword, domain.AuthCheckTypePassword.Class())
}

func TestAuthAttempt_IsCompleted_EnrollmentSatisfiesPasskeyClass(t *testing.T) {
	attempt := &domain.AuthAttempt{
		RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypeUser, domain.AuthCheckTypePasskey},
		Checks: []domain.AuthCheck{
			&domain.AuthFactorUser{UserID: "user-1"},
			&domain.AuthFactorPasskeyRegistration{UserID: "user-1", CredentialID: "cred-1"},
		},
	}
	assert.True(t, attempt.IsCompleted(),
		"a completed enrollment must satisfy a required passkey check")

	incomplete := &domain.AuthAttempt{
		RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePasskey},
		Checks:         []domain.AuthCheck{&domain.AuthFactorPassword{}},
	}
	assert.False(t, incomplete.IsCompleted())
}

func TestAuthAttempt_SetPasskeyRegistrationFactor(t *testing.T) {
	t.Run("replaces the registration challenge", func(t *testing.T) {
		challenge := domain.SetAuthChallengePasskeyRegistration("ch-reg-1", time.Now(), time.Time{}, 0)
		attempt := &domain.AuthAttempt{
			ProjectID: "proj", ID: "att-1",
			Checks: []domain.AuthCheck{challenge},
		}

		factor := attempt.SetPasskeyRegistrationFactor(&domain.CreateUserPasskey{
			UserID:         "user-1",
			CredentialID:   "cred-1",
			UserVerified:   true,
			BackupEligible: true,
		})

		assert.Equal(t, "user-1", factor.UserID)
		assert.Equal(t, "cred-1", factor.CredentialID)
		assert.True(t, factor.UserVerified)
		assert.True(t, factor.BackupEligible)

		got, ok := attempt.FactorByType(domain.AuthCheckTypePasskeyRegistration)
		require.True(t, ok)
		assert.Same(t, factor, got)
		_, stillChallenged := attempt.ChallengeByType(domain.AuthCheckTypePasskeyRegistration)
		assert.False(t, stillChallenged, "the registration challenge must be consumed by the factor")
	})

	t.Run("coexists with a passkey login check", func(t *testing.T) {
		attempt := &domain.AuthAttempt{
			ProjectID: "proj", ID: "att-1",
			Checks: []domain.AuthCheck{&domain.AuthFactorPasskey{UserID: "user-1"}},
		}

		attempt.SetPasskeyRegistrationFactor(&domain.CreateUserPasskey{UserID: "user-1", CredentialID: "cred-2"})

		_, hasLogin := attempt.FactorByType(domain.AuthCheckTypePasskey)
		_, hasRegistration := attempt.FactorByType(domain.AuthCheckTypePasskeyRegistration)
		assert.True(t, hasLogin)
		assert.True(t, hasRegistration)
	})
}
