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
	require.Equal(t, "flow", domain.TokenTypeFlow.String())
	require.Equal(t, "jwt_profile", domain.TokenTypeJWTProfile.String())

	got, err := domain.TokenTypeString("oidc_access_token")
	require.NoError(t, err)
	require.Equal(t, domain.TokenTypeOIDCAccessToken, got)

	got, err = domain.TokenTypeString("jwt_profile")
	require.NoError(t, err)
	require.Equal(t, domain.TokenTypeJWTProfile, got)
}

func TestTokenType_Persistable(t *testing.T) {
	t.Parallel()
	require.False(t, domain.TokenTypeUnspecified.Persistable())
	require.False(t, domain.TokenTypeFlow.Persistable())
	require.False(t, domain.TokenTypeJWTProfile.Persistable())
	require.True(t, domain.TokenTypeSessionToken.Persistable())
	require.True(t, domain.TokenTypePersonalAccessToken.Persistable())
}

func TestTokenType_IsProjectSecret(t *testing.T) {
	t.Parallel()
	require.True(t, domain.TokenTypeProjectToken.IsProjectSecret())
	require.True(t, domain.TokenTypeProjectPreview.IsProjectSecret())
	require.False(t, domain.TokenTypeUnspecified.IsProjectSecret())
	require.False(t, domain.TokenTypeSessionToken.IsProjectSecret())
	require.False(t, domain.TokenTypeJWTProfile.IsProjectSecret())
}

func TestTokenType_Value_notPersistable(t *testing.T) {
	t.Parallel()
	for _, tt := range []domain.TokenType{
		domain.TokenTypeUnspecified,
		domain.TokenTypeFlow,
		domain.TokenTypeJWTProfile,
	} {
		_, err := tt.Value()
		require.ErrorIs(t, err, domain.ErrInvalidTokenType, tt.String())
	}
}
