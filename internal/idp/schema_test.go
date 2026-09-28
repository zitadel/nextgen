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
	var schema struct {
		Properties struct {
			OIDC struct {
				Properties struct {
					Issuer struct {
						Pattern string `json:"pattern"`
					} `json:"issuer"`
					JWKSURI struct {
						Pattern string `json:"pattern"`
					} `json:"jwks_uri"`
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
	require.Equal(t, oidc.JWKSURI.Pattern, endpointPattern.String())
	require.Equal(t, oidc.StaticAuthorizeParameters.PropertyNames.Not.Enum, reservedAuthorizeParameters)
}
