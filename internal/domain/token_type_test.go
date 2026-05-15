package domain_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestTokenType_StringAndParse(t *testing.T) {
	t.Parallel()
	require.Equal(t, "session_token", domain.TokenTypeSessionToken.String())
	require.Equal(t, "oidc_access_token", domain.TokenTypeOIDCAccessToken.String())
	require.Equal(t, "saml_assertion", domain.TokenTypeSAMLAssertion.String())
	require.Equal(t, "personal_access_token", domain.TokenTypePersonalAccessToken.String())
	require.Equal(t, "unspecified", domain.TokenTypeUnspecified.String())

	got, err := domain.TokenTypeString("oidc_access_token")
	require.NoError(t, err)
	require.Equal(t, domain.TokenTypeOIDCAccessToken, got)
}

func TestTokenType_Persistable(t *testing.T) {
	t.Parallel()
	require.False(t, domain.TokenTypeUnspecified.Persistable())
	require.True(t, domain.TokenTypeSessionToken.Persistable())
}

func TestTokenType_Value_unspecified(t *testing.T) {
	t.Parallel()
	_, err := domain.TokenTypeUnspecified.Value()
	require.ErrorIs(t, err, domain.ErrInvalidTokenType)
}
