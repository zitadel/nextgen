package oauth

import (
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func mustParseURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	require.NoError(t, err)
	return u
}

// The browser-facing endpoints hang off the issuer, wherever it is served
// from; the back-channel ones are under the server's public base, path
// included, at the same project ID path, and the platform project's at the
// prefix itself.
func TestEndpointFactoryFor(t *testing.T) {
	t.Parallel()
	factory := NewEndpointFactory(mustParseURL(t, "https://api.example.com/zitadel/"))

	for _, tt := range []struct {
		name   string
		issuer Issuer
		want   EndpointURLs
	}{
		{
			name:   "customer issuer through the SDK proxy",
			issuer: Issuer{ProjectID: "proj_123", URL: mustParseURL(t, "https://app.example.com/__nextgen/oauth/proj_123")},
			want: EndpointURLs{
				Authorization: "https://app.example.com/__nextgen/oauth/proj_123/authorize",
				EndSession:    "https://app.example.com/__nextgen/oauth/proj_123/end_session",
				Token:         "https://api.example.com/zitadel/oauth/proj_123/token",
				Revocation:    "https://api.example.com/zitadel/oauth/proj_123/revoke",
				JWKS:          "https://api.example.com/zitadel/oauth/proj_123/jwks",
				Userinfo:      "https://api.example.com/zitadel/oauth/proj_123/userinfo",
			},
		},
		{
			name:   "platform issuer",
			issuer: Issuer{ProjectID: domain.PlatformProjectID, URL: mustParseURL(t, "https://api.example.com/zitadel/oauth"), Platform: true},
			want: EndpointURLs{
				Authorization: "https://api.example.com/zitadel/oauth/authorize",
				EndSession:    "https://api.example.com/zitadel/oauth/end_session",
				Token:         "https://api.example.com/zitadel/oauth/token",
				Revocation:    "https://api.example.com/zitadel/oauth/revoke",
				JWKS:          "https://api.example.com/zitadel/oauth/jwks",
				Userinfo:      "https://api.example.com/zitadel/oauth/userinfo",
			},
		},
		{
			name:   "loopback issuer",
			issuer: Issuer{ProjectID: "proj_123", URL: mustParseURL(t, "http://localhost:3000/oauth/proj_123")},
			want: EndpointURLs{
				Authorization: "http://localhost:3000/oauth/proj_123/authorize",
				EndSession:    "http://localhost:3000/oauth/proj_123/end_session",
				Token:         "https://api.example.com/zitadel/oauth/proj_123/token",
				Revocation:    "https://api.example.com/zitadel/oauth/proj_123/revoke",
				JWKS:          "https://api.example.com/zitadel/oauth/proj_123/jwks",
				Userinfo:      "https://api.example.com/zitadel/oauth/proj_123/userinfo",
			},
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, factory.For(tt.issuer))
		})
	}
}
