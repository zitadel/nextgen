package domain_test

import (
	"bytes"
	"encoding/base64"
	"errors"
	"log/slog"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/crypto"
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
	crypter := &crypto.InverseCrypter{}

	t.Run("mints every secret and hashes the state into the id", func(t *testing.T) {
		sso, err := domain.NewSSOState("google", "idprev_1", "/after-login", crypter)
		require.NoError(t, err)
		require.NotNil(t, sso)
		check := sso.Check
		require.NotNil(t, check)

		assert.Equal(t, domain.HashSecret(sso.State), check.ID)
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
		assert.Equal(t, 16, decodedLen(t, sso.State))
		assert.Equal(t, 16, decodedLen(t, check.Pending.BindingNonce))
		assert.Equal(t, 16, decodedLen(t, check.Pending.OIDCNonce))
		assert.Equal(t, 32, decodedLen(t, sso.PKCEVerifier))
	})

	t.Run("the verifier is stored encrypted and round-trips", func(t *testing.T) {
		sso, err := domain.NewSSOState("google", "idprev_1", "/after-login", crypter)
		require.NoError(t, err)

		stored := sso.Check.Pending.EncryptedPKCEVerifier
		require.NotEmpty(t, stored)
		assert.NotEqual(t, sso.PKCEVerifier, stored, "the record must never hold the plaintext verifier")

		decrypted, err := sso.Check.Pending.DecryptPKCEVerifier(crypter)
		require.NoError(t, err)
		assert.Equal(t, sso.PKCEVerifier, decrypted)

		// What the submit step sends to the provider is derived from the
		// plaintext the constructor handed back, never from the record.
		assert.Equal(t, domain.PKCEChallenge(sso.PKCEVerifier), domain.PKCEChallenge(decrypted))
	})

	t.Run("two calls share no secret", func(t *testing.T) {
		first, err := domain.NewSSOState("google", "idprev_1", "/after-login", crypter)
		require.NoError(t, err)
		second, err := domain.NewSSOState("google", "idprev_1", "/after-login", crypter)
		require.NoError(t, err)

		assert.NotEqual(t, first.State, second.State)
		assert.NotEqual(t, first.Check.ID, second.Check.ID)
		assert.NotEqual(t, first.PKCEVerifier, second.PKCEVerifier)
		assert.NotEqual(t, first.Check.Pending.EncryptedPKCEVerifier, second.Check.Pending.EncryptedPKCEVerifier)
		assert.NotEqual(t, first.Check.Pending.BindingNonce, second.Check.Pending.BindingNonce)
		assert.NotEqual(t, first.Check.Pending.OIDCNonce, second.Check.Pending.OIDCNonce)
	})

	t.Run("no encrypter means no pkce", func(t *testing.T) {
		sso, err := domain.NewSSOState("github", "idprev_2", "", nil)
		require.NoError(t, err)
		assert.Empty(t, sso.PKCEVerifier)
		assert.Empty(t, sso.Check.Pending.EncryptedPKCEVerifier)
		assert.NotEmpty(t, sso.Check.Pending.OIDCNonce)
		assert.NotEmpty(t, sso.Check.Pending.BindingNonce)

		decrypted, err := sso.Check.Pending.DecryptPKCEVerifier(crypter)
		require.NoError(t, err)
		assert.Empty(t, decrypted)
	})
}

// keyedCrypter stands in for one project secret key. Its ciphertext names the
// writing key, the way the real compact JWE carries its kid.
type keyedCrypter struct{ keyID string }

func (c keyedCrypter) Encrypt(plain string) (string, error) {
	return c.keyID + ":" + base64.StdEncoding.EncodeToString([]byte(plain)), nil
}

func (c keyedCrypter) Decrypt(encrypted string) (string, error) {
	keyID, body, ok := strings.Cut(encrypted, ":")
	if !ok || keyID != c.keyID {
		return "", errors.New("ciphertext was written by another key")
	}
	plain, err := base64.StdEncoding.DecodeString(body)
	return string(plain), err
}

// TestSSOStatePayload_DecryptPKCEVerifierResolvesTheWritingKey pins why the
// decrypter must come from the ciphertext's key id: the ceremony can outlive a
// rotation of the project's active secret key.
func TestSSOStatePayload_DecryptPKCEVerifierResolvesTheWritingKey(t *testing.T) {
	t.Parallel()
	issuing := keyedCrypter{keyID: "key-1"}
	rotated := keyedCrypter{keyID: "key-2"}

	sso, err := domain.NewSSOState("google", "idprev_1", "/after-login", issuing)
	require.NoError(t, err)

	// The active key rotated while the ceremony was in flight.
	_, err = sso.Check.Pending.DecryptPKCEVerifier(rotated)
	require.ErrorIs(t, err, domain.ErrDecryptionFailed(nil))

	// Resolving the key the ciphertext names still works, and a
	// crypto.DecrypterFn satisfies the parameter, so a service can pass the
	// decrypterOfWritingKey closure straight in.
	byWritingKey := crypto.DecrypterFn(func(encrypted string) (string, error) {
		keyID, _, _ := strings.Cut(encrypted, ":")
		for _, candidate := range []keyedCrypter{rotated, issuing} {
			if candidate.keyID == keyID {
				return candidate.Decrypt(encrypted)
			}
		}
		return "", errors.New("unknown key " + keyID)
	})
	verifier, err := sso.Check.Pending.DecryptPKCEVerifier(byWritingKey)
	require.NoError(t, err)
	assert.Equal(t, sso.PKCEVerifier, verifier)
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
	crypter := &crypto.InverseCrypter{}
	sso, err := domain.NewSSOState("google", "idprev_1", "/after-login", crypter)
	require.NoError(t, err)
	check := sso.Check
	check.AuthAttemptID = "att_1"
	check.Result = &domain.SSOCallbackResult{
		Subject:              "sub-1",
		ConnectionRevisionID: "idprev_1",
		Claims:               map[string]any{"email": "alice@example.com"},
	}

	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	// Both forms: a value passed to slog only redacts when the receiver is a
	// value, otherwise the handler reflects over the struct and prints
	// everything in it.
	logger.Info("sso",
		"sso_ptr", sso, "sso_value", *sso,
		"check_ptr", check, "check_value", *check,
		"payload_ptr", check.Pending, "payload_value", *check.Pending,
		"result_ptr", check.Result, "result_value", *check.Result,
	)
	logged := buf.String()

	for _, secret := range []string{
		sso.State,
		sso.PKCEVerifier,
		check.Pending.EncryptedPKCEVerifier,
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
