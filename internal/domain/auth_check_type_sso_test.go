package domain_test

import (
	"bytes"
	"encoding/base64"
	"log/slog"
	"reflect"
	"regexp"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestAuthCheckTypeSSOCallback_WireName(t *testing.T) {
	t.Parallel()
	assert.Equal(t, "sso_callback", domain.AuthCheckTypeSSOCallback.String())
	// The callback check is its own factor class: nothing competes with it.
	assert.Equal(t, domain.AuthCheckTypeSSOCallback, domain.AuthCheckTypeSSOCallback.Class())
}

func TestNewSSOState(t *testing.T) {
	t.Parallel()

	t.Run("mints every secret and hashes the state into the id", func(t *testing.T) {
		state, check, err := domain.NewSSOState("google", "idprev_1", "/after-login", true)
		require.NoError(t, err)
		require.NotNil(t, check)

		assert.Equal(t, domain.HashSecret(state), check.ID)
		assert.Equal(t, domain.AuthCheckTypeSSOCallback, check.Type())
		assert.True(t, check.IssuedAt.IsZero(), "the storage layer stamps the issue time")
		assert.Nil(t, check.Result)
		assert.Empty(t, check.AuthAttemptID)

		require.NotNil(t, check.Pending)
		assert.Equal(t, "google", check.Pending.ProviderSlug)
		assert.Equal(t, "idprev_1", check.Pending.ConnectionRevisionID)
		assert.Equal(t, "/after-login", check.Pending.ReturnTarget)
		assert.Same(t, check.Pending, check.Payload())

		decodedLen := func(t *testing.T, value string) int {
			t.Helper()
			raw, err := base64.RawURLEncoding.DecodeString(value)
			require.NoError(t, err)
			return len(raw)
		}
		assert.Equal(t, 16, decodedLen(t, state))
		assert.Equal(t, 16, decodedLen(t, check.Pending.BindingNonce))
		assert.Equal(t, 16, decodedLen(t, check.Pending.OIDCNonce))
		assert.Equal(t, 32, decodedLen(t, check.Pending.PKCEVerifier))
	})

	t.Run("two calls share no secret", func(t *testing.T) {
		firstState, first, err := domain.NewSSOState("google", "idprev_1", "/after-login", true)
		require.NoError(t, err)
		secondState, second, err := domain.NewSSOState("google", "idprev_1", "/after-login", true)
		require.NoError(t, err)

		assert.NotEqual(t, firstState, secondState)
		assert.NotEqual(t, first.ID, second.ID)
		assert.NotEqual(t, first.Pending.BindingNonce, second.Pending.BindingNonce)
		assert.NotEqual(t, first.Pending.OIDCNonce, second.Pending.OIDCNonce)
		assert.NotEqual(t, first.Pending.PKCEVerifier, second.Pending.PKCEVerifier)
	})

	t.Run("no pkce means no verifier", func(t *testing.T) {
		_, check, err := domain.NewSSOState("github", "idprev_2", "", false)
		require.NoError(t, err)
		assert.Empty(t, check.Pending.PKCEVerifier)
		assert.NotEmpty(t, check.Pending.OIDCNonce)
		assert.NotEmpty(t, check.Pending.BindingNonce)
	})
}

// TestPKCEChallenge pins the S256 transformation against the worked example in
// RFC 7636 appendix B.
func TestPKCEChallenge(t *testing.T) {
	t.Parallel()
	assert.Equal(t,
		"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
		domain.PKCEChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
	)
}

func TestSSOState_LogValueOmitsSecrets(t *testing.T) {
	t.Parallel()
	state, check, err := domain.NewSSOState("google", "idprev_1", "/after-login", true)
	require.NoError(t, err)
	check.AuthAttemptID = "att_1"
	check.Result = &domain.SSOCallbackResult{
		Subject:              "sub-1",
		ConnectionRevisionID: "idprev_1",
		Claims:               map[string]any{"email": "alice@example.com"},
	}

	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	logger.Info("sso", "check", check, "payload", check.Pending, "result", check.Result)
	logged := buf.String()

	for _, secret := range []string{
		state,
		check.Pending.PKCEVerifier,
		check.Pending.OIDCNonce,
		check.Pending.BindingNonce,
		"alice@example.com",
	} {
		assert.NotContains(t, logged, secret)
	}
	assert.Contains(t, logged, check.ID)
	assert.Contains(t, logged, "sub-1")
	assert.Contains(t, logged, "google")
}

// TestSSOCallbackResult_NoTokenFields keeps the stored result free of the
// tokens and the authorization code the exchange handled: the record answers
// who the provider asserted, nothing more.
func TestSSOCallbackResult_NoTokenFields(t *testing.T) {
	t.Parallel()
	forbidden := regexp.MustCompile(`(?i)token|code`)
	typ := reflect.TypeFor[domain.SSOCallbackResult]()
	for i := range typ.NumField() {
		assert.NotRegexp(t, forbidden, typ.Field(i).Name)
	}
}

func TestErrSSOStateInvalid(t *testing.T) {
	t.Parallel()
	assert.ErrorIs(t, domain.ErrSSOStateInvalid().WithMessage("something else"), domain.ErrSSOStateInvalid())
}

// TestSSOCallbackCheck_IsNotFactorOrChallenge is the contract that keeps the
// record out of every factor and challenge path: it is only an AuthCheck.
func TestSSOCallbackCheck_IsNotFactorOrChallenge(t *testing.T) {
	t.Parallel()
	var check domain.AuthCheck = &domain.SSOCallbackCheck{ID: "hash"}
	_, isFactor := check.(domain.AuthFactor)
	assert.False(t, isFactor)
	_, isChallenge := check.(domain.AuthChallenge)
	assert.False(t, isChallenge)
}
