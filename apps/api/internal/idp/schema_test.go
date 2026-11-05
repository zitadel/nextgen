package idp

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

// The URL patterns and the reserved parameter list are copies of the
// connection schema, so a schema edit that misses this package is caught
// here rather than at runtime.
func TestPatternsMatchSchema(t *testing.T) {
	raw, err := os.ReadFile("../../api/openapi/endpoints/schemas/idp-connection.json")
	require.NoError(t, err)
	type pattern struct {
		Pattern string `json:"pattern"`
	}
	var schema struct {
		Properties struct {
			OIDC struct {
				Properties struct {
					Issuer                    pattern `json:"issuer"`
					JWKSURI                   pattern `json:"jwks_uri"`
					AuthorizationEndpoint     pattern `json:"authorization_endpoint"`
					TokenEndpoint             pattern `json:"token_endpoint"`
					UserinfoEndpoint          pattern `json:"userinfo_endpoint"`
					StaticAuthorizeParameters struct {
						PropertyNames struct {
							Not struct {
								Enum []string `json:"enum"`
							} `json:"not"`
						} `json:"propertyNames"`
					} `json:"static_authorize_parameters"`
				} `json:"properties"`
			} `json:"oidc"`
		} `json:"properties"`
	}
	require.NoError(t, json.Unmarshal(raw, &schema))
	oidc := schema.Properties.OIDC.Properties
	require.Equal(t, oidc.Issuer.Pattern, issuerPattern.String())
	// Every endpoint is checked against the one Go pattern, so a schema edit to
	// any of them fails here rather than as a 500 at create.
	for name, field := range map[string]pattern{
		"jwks_uri":               oidc.JWKSURI,
		"authorization_endpoint": oidc.AuthorizationEndpoint,
		"token_endpoint":         oidc.TokenEndpoint,
		"userinfo_endpoint":      oidc.UserinfoEndpoint,
	} {
		require.Equal(t, field.Pattern, endpointPattern.String(), name)
	}
	require.Equal(t, oidc.StaticAuthorizeParameters.PropertyNames.Not.Enum, reservedAuthorizeParameters)
}
