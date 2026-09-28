package session_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/session"
)

func TestHashHandoffToken(t *testing.T) {
	t.Parallel()
	got := session.HashHandoffToken("plain")
	require.Len(t, got, 32)
	assert.Equal(t, session.HashHandoffToken("plain"), got)
	assert.NotEqual(t, session.HashHandoffToken("other"), got)
}

func TestExchangeTTL(t *testing.T) {
	t.Parallel()
	assert.Equal(t, domain.SessionAnonymousTTL, session.ExchangeTTL(0))
	assert.Equal(t, 2*time.Hour, session.ExchangeTTL(2*time.Hour))
}

func TestValidateHandoffAttempt(t *testing.T) {
	t.Parallel()
	now := time.Now()
	hash := session.HashHandoffToken("tok")

	t.Run("missing handoff", func(t *testing.T) {
		err := session.ValidateHandoffAttempt(&domain.AuthAttempt{})
		assert.ErrorIs(t, err, domain.ErrSessionInvalidHandoffToken())
	})

	t.Run("expired handoff", func(t *testing.T) {
		handedOff := now.Add(-2 * domain.HandoffTokenExpiration)
		err := session.ValidateHandoffAttempt(&domain.AuthAttempt{
			HandoffToken: &domain.HandoffToken{TokenHash: hash},
			HandedOffAt:  &handedOff,
		})
		assert.ErrorIs(t, err, domain.ErrSessionInvalidHandoffToken())
	})

	t.Run("valid", func(t *testing.T) {
		handedOff := now
		err := session.ValidateHandoffAttempt(&domain.AuthAttempt{
			HandoffToken: &domain.HandoffToken{TokenHash: hash},
			HandedOffAt:  &handedOff,
		})
		assert.NoError(t, err)
	})
}

func TestPickLastVerifiedByType(t *testing.T) {
	t.Parallel()
	earlier := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	later := earlier.Add(time.Hour)
	sessionChecks := []session.StoredCheck{
		{ID: "s-pw", Type: domain.AuthCheckTypePassword, LastVerifiedAt: earlier},
		{ID: "s-user", Type: domain.AuthCheckTypeUser, LastVerifiedAt: later},
	}
	attemptChecks := []session.StoredCheck{
		{ID: "a-pw", Type: domain.AuthCheckTypePassword, LastVerifiedAt: later, OnAttempt: true},
		{ID: "a-pk", Type: domain.AuthCheckTypePasskey, LastVerifiedAt: earlier, OnAttempt: true},
	}
	got := session.PickLastVerifiedByType(attemptChecks, sessionChecks)
	assert.Equal(t, "a-pw", got[domain.AuthCheckTypePassword].ID)
	assert.Equal(t, "s-user", got[domain.AuthCheckTypeUser].ID)
	assert.Equal(t, "a-pk", got[domain.AuthCheckTypePasskey].ID)
}

func TestPickLastVerifiedByType_PasskeyClass(t *testing.T) {
	t.Parallel()
	earlier := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	later := earlier.Add(time.Hour)

	t.Run("newer enrollment beats an older login factor", func(t *testing.T) {
		got := session.PickLastVerifiedByType(
			[]session.StoredCheck{{ID: "a-reg", Type: domain.AuthCheckTypePasskeyRegistration, LastVerifiedAt: later, OnAttempt: true}},
			[]session.StoredCheck{{ID: "s-pk", Type: domain.AuthCheckTypePasskey, LastVerifiedAt: earlier}},
		)
		require.Len(t, got, 1)
		assert.Equal(t, "a-reg", got[domain.AuthCheckTypePasskey].ID)
	})

	t.Run("newer login factor beats an older enrollment", func(t *testing.T) {
		got := session.PickLastVerifiedByType(
			[]session.StoredCheck{{ID: "a-pk", Type: domain.AuthCheckTypePasskey, LastVerifiedAt: later, OnAttempt: true}},
			[]session.StoredCheck{{ID: "s-reg", Type: domain.AuthCheckTypePasskeyRegistration, LastVerifiedAt: earlier}},
		)
		require.Len(t, got, 1)
		assert.Equal(t, "a-pk", got[domain.AuthCheckTypePasskey].ID)
	})
}

func TestUserAgentFromStoredInfo(t *testing.T) {
	t.Parallel()
	ua := session.UserAgentFromStoredInfo(map[string]any{
		"ip":                            "203.0.113.1",
		session.UserAgentFingerprintKey: "fp-1",
		"browser":                       "test",
	})
	require.NotNil(t, ua)
	assert.Equal(t, "203.0.113.1", ua.IP)
	assert.Equal(t, "fp-1", ua.ID)
	assert.Equal(t, "test", ua.Info["browser"])
}

func TestAppendFactor(t *testing.T) {
	t.Parallel()
	sess := &domain.Session{}
	first := domain.SetAuthFactorPassword(time.Now())
	session.AppendFactor(sess, first)
	require.Len(t, sess.Factors, 1)

	second := domain.SetAuthFactorPassword(time.Now().Add(time.Minute))
	session.AppendFactor(sess, second)
	require.Len(t, sess.Factors, 1)
	assert.Equal(t, second, sess.Factors[0])

	user := domain.SetAuthFactorUser(time.Now())
	session.AppendFactor(sess, user)
	require.Len(t, sess.Factors, 2)
}

func TestAppendFactor_NormalizesEnrollmentToPasskey(t *testing.T) {
	t.Parallel()
	sess := &domain.Session{}
	verifiedAt := time.Date(2024, 2, 3, 4, 5, 6, 0, time.UTC)

	registration := domain.SetAuthFactorPasskeyRegistration(verifiedAt)
	registration.UserID = "user-1"
	registration.UserVerified = true
	registration.CredentialID = domain.EncodePasskeyCredentialID([]byte("cred-1"))
	session.AppendFactor(sess, registration)

	require.Len(t, sess.Factors, 1)
	passkey, ok := sess.Factors[0].(*domain.AuthFactorPasskey)
	require.True(t, ok, "an enrollment factor must land on the session as a passkey factor")
	assert.Equal(t, "user-1", passkey.UserID)
	assert.True(t, passkey.UserVerified)
	assert.Equal(t, []byte("cred-1"), passkey.CredentialID)
	assert.Equal(t, verifiedAt, passkey.GetLastVerifiedAt())

	// A later login factor replaces the enrollment in the same class slot.
	login := domain.SetAuthFactorPasskey(verifiedAt.Add(time.Hour))
	session.AppendFactor(sess, login)
	require.Len(t, sess.Factors, 1)
	assert.Same(t, login, sess.Factors[0])
}

func TestDecodeAuthChecks(t *testing.T) {
	t.Parallel()
	verified := time.Date(2024, 2, 3, 4, 5, 6, 0, time.UTC)
	payload := json.RawMessage(`{"UserID":"u-1"}`)
	checks, err := session.DecodeAuthChecks(
		domain.AuthCheckTypeUser,
		"chk-1",
		time.Time{},
		time.Time{},
		verified,
		0,
		nil,
		payload,
	)
	require.NoError(t, err)
	require.Len(t, checks, 1)
	require.IsType(t, &domain.AuthFactorUser{}, checks[0])
	userFactor := checks[0].(*domain.AuthFactorUser)
	assert.Equal(t, "u-1", userFactor.UserID)

	_, err = session.DecodeAuthChecks(domain.AuthCheckType(255), "x", time.Time{}, time.Time{}, time.Time{}, 0, nil, nil)
	require.Error(t, err)
}
