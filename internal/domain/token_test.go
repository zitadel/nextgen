package domain_test

import (
	"context"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/oidc/v3/pkg/op"
)

func TestToken_ValidatePersisted(t *testing.T) {
	t.Parallel()

	sess := "sess_1"
	oidc := "oidc_1"
	saml := "saml_1"

	t.Run("session_token", func(t *testing.T) {
		t.Parallel()
		require.NoError(t, (&domain.Token{
			Type: domain.TokenTypeSessionToken, SessionID: &sess,
		}).ValidatePersisted())
		require.Error(t, (&domain.Token{Type: domain.TokenTypeSessionToken}).ValidatePersisted())
		require.Error(t, (&domain.Token{
			Type: domain.TokenTypeSessionToken, SessionID: &sess, OIDCSessionID: &oidc,
		}).ValidatePersisted())
	})

	t.Run("oidc_access_token", func(t *testing.T) {
		t.Parallel()
		require.NoError(t, (&domain.Token{
			Type: domain.TokenTypeOIDCAccessToken, OIDCSessionID: &oidc,
		}).ValidatePersisted())
		require.Error(t, (&domain.Token{
			Type: domain.TokenTypeOIDCAccessToken, SessionID: &sess,
		}).ValidatePersisted())
	})

	t.Run("saml_assertion", func(t *testing.T) {
		t.Parallel()
		require.NoError(t, (&domain.Token{
			Type: domain.TokenTypeSAMLAssertion, SAMLSessionID: &saml,
		}).ValidatePersisted())
		require.Error(t, (&domain.Token{
			Type: domain.TokenTypeSAMLAssertion, SessionID: &sess,
		}).ValidatePersisted())
	})

	t.Run("personal_access_token", func(t *testing.T) {
		t.Parallel()
		require.NoError(t, (&domain.Token{Type: domain.TokenTypePersonalAccessToken}).ValidatePersisted())
		require.Error(t, (&domain.Token{
			Type: domain.TokenTypePersonalAccessToken, SessionID: &sess,
		}).ValidatePersisted())
	})

	t.Run("not_persistable", func(t *testing.T) {
		t.Parallel()
		require.ErrorIs(t, (&domain.Token{Type: domain.TokenTypeFlow}).ValidatePersisted(), domain.ErrInvalidTokenType)
	})
}

// jweWithHeader is a compact JWE whose protected header is header verbatim;
// the remaining segments are never read when the header is refused.
func jweWithHeader(header string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(header)) + ".key.iv.ciphertext.tag"
}

// storedKeyHeaderRefusals are JWE headers a client could present that name
// something no stored encryption key seals with.
var storedKeyHeaderRefusals = []struct {
	name   string
	header string
}{
	{"nul byte in kid", `{"alg":"A256GCMKW","enc":"A256GCM","kid":"a\u0000b"}`},
	{"invalid utf-8 in kid", "{\"alg\":\"A256GCMKW\",\"enc\":\"A256GCM\",\"kid\":\"enc_key_\xff\xfe\"}"},
	{"over-long kid", `{"alg":"A256GCMKW","enc":"A256GCM","kid":"enc_key_` + strings.Repeat("A", 4096) + `"}`},
	{"unknown kid format", `{"alg":"A256GCMKW","enc":"A256GCM","kid":"key-1"}`},
	{"kid of another resource", `{"alg":"A256GCMKW","enc":"A256GCM","kid":"sig_key_01JAAAAAAAAAAAAAAAAAAAAAAA"}`},
	{"lowercase ulid kid", `{"alg":"A256GCMKW","enc":"A256GCM","kid":"enc_key_01jaaaaaaaaaaaaaaaaaaaaaaa"}`},
	{"missing kid", `{"alg":"A256GCMKW","enc":"A256GCM"}`},
	{"unsupported enc", `{"alg":"A256GCMKW","enc":"A128CBC-HS256","kid":"enc_key_01JAAAAAAAAAAAAAAAAAAAAAAA"}`},
	{"missing enc", `{"alg":"A256GCMKW","kid":"enc_key_01JAAAAAAAAAAAAAAAAAAAAAAA"}`},
	{"unsupported alg", `{"alg":"dir","enc":"A256GCM","kid":"enc_key_01JAAAAAAAAAAAAAAAAAAAAAAA"}`},
	{"master key alg", `{"alg":"RSA-OAEP-256","enc":"A256GCM","kid":"enc_key_01JAAAAAAAAAAAAAAAAAAAAAAA"}`},
}

func TestDecodeStoredKeyJWEHeader(t *testing.T) {
	t.Parallel()

	for _, kid := range []string{
		"enc_key_01JAAAAAAAAAAAAAAAAAAAAAAA",
		"enc_key_3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
	} {
		t.Run("accepts minted kid "+kid, func(t *testing.T) {
			t.Parallel()
			header, err := domain.DecodeStoredKeyJWEHeader(jweWithHeader(`{"alg":"A256GCMKW","enc":"A256GCM","kid":"` + kid + `"}`))
			require.NoError(t, err)
			require.Equal(t, kid, header.KeyID)
			require.Equal(t, jose.A256GCM, header.EncryptionAlgorithm)
		})
	}

	for _, tc := range storedKeyHeaderRefusals {
		t.Run("refuses "+tc.name, func(t *testing.T) {
			t.Parallel()
			_, err := domain.DecodeStoredKeyJWEHeader(jweWithHeader(tc.header))
			require.ErrorIs(t, err, domain.ErrInvalidToken())
		})
	}
}

func TestParseAndValidateToken(t *testing.T) {
	t.Parallel()

	const kid = "enc_key_01JAAAAAAAAAAAAAAAAAAAAAAA"
	crypter := op.NewAES256GCMCrypto([32]byte{1}, kid)

	t.Run("decrypts a token sealed by a stored key", func(t *testing.T) {
		t.Parallel()
		sealed, err := (&domain.Token{ProjectID: "proj_1", Type: domain.TokenTypePersonalAccessToken}).JWE(crypter)
		require.NoError(t, err)

		got, err := domain.ParseAndValidateToken(t.Context(), sealed,
			func(_ context.Context, keyID string, algorithm jose.ContentEncryption) (op.Decrypter, error) {
				require.Equal(t, kid, keyID)
				require.Equal(t, jose.A256GCM, algorithm)
				return crypter, nil
			})
		require.NoError(t, err)
		require.Equal(t, "proj_1", got.ProjectID)
	})

	for _, tc := range storedKeyHeaderRefusals {
		t.Run("refuses "+tc.name+" without looking up a key", func(t *testing.T) {
			t.Parallel()
			_, err := domain.ParseAndValidateToken(t.Context(), jweWithHeader(tc.header),
				func(context.Context, string, jose.ContentEncryption) (op.Decrypter, error) {
					t.Error("the key lookup must not see a refused header")
					return nil, domain.ErrInternal(nil)
				})
			require.ErrorIs(t, err, domain.ErrInvalidToken())
		})
	}
}
