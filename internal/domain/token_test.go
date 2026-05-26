package domain_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
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
