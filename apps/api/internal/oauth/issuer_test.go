package oauth

import (
	"cmp"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/httputil"
)

// The issuer is the URL the client fetched: the forwarded origin,
// normalized, the prefix a known proxy stripped, and the tenant. Anything
// the server cannot vouch for gives no issuer.
func TestDeriveIssuer(t *testing.T) {
	t.Parallel()

	for _, tt := range []struct {
		name            string
		platformEnabled bool
		publicBase      string
		tenant          string
		host            string
		headers         map[string]string
		want            Issuer
		wantErr         error
	}{
		{
			name:    "direct request",
			tenant:  "proj_123",
			host:    "app.example.com",
			headers: map[string]string{"X-Forwarded-Proto": "https"},
			want:    Issuer{ProjectID: "proj_123", URL: mustParseURL(t, "https://app.example.com/oauth/proj_123")},
		},
		{
			name:   "through the SDK proxy",
			tenant: "proj_123",
			host:   "api.internal",
			headers: map[string]string{
				"X-Forwarded-Proto":  "https",
				"X-Forwarded-Host":   "app.example.com",
				"X-Forwarded-Prefix": httputil.ProxyPrefix,
			},
			want: Issuer{ProjectID: "proj_123", URL: mustParseURL(t, "https://app.example.com/__nextgen/oauth/proj_123")},
		},
		{
			name:    "origin is normalized",
			tenant:  "proj_123",
			host:    "App.Example.COM",
			headers: map[string]string{"X-Forwarded-Proto": "HTTPS"},
			want:    Issuer{ProjectID: "proj_123", URL: mustParseURL(t, "https://app.example.com/oauth/proj_123")},
		},
		{
			name:   "loopback keeps its port",
			tenant: "proj_123",
			host:   "localhost:3000",
			want:   Issuer{ProjectID: "proj_123", URL: mustParseURL(t, "http://localhost:3000/oauth/proj_123")},
		},
		{
			name:            "empty tenant with a platform project",
			platformEnabled: true,
			host:            "api.example.com",
			headers:         map[string]string{"X-Forwarded-Proto": "https"},
			want:            Issuer{ProjectID: domain.PlatformProjectID, URL: mustParseURL(t, "https://api.example.com/oauth"), Platform: true},
		},
		{
			name:            "empty tenant through the SDK proxy",
			platformEnabled: true,
			host:            "api.internal",
			headers: map[string]string{
				"X-Forwarded-Proto":  "https",
				"X-Forwarded-Host":   "api.example.com",
				"X-Forwarded-Prefix": httputil.ProxyPrefix,
			},
			wantErr: domain.ErrOriginInvalid(),
		},
		{
			name:            "empty tenant under a public base with a path",
			platformEnabled: true,
			publicBase:      "https://api.example.com/zitadel/",
			host:            "api.example.com",
			headers:         map[string]string{"X-Forwarded-Proto": "https"},
			want:            Issuer{ProjectID: domain.PlatformProjectID, URL: mustParseURL(t, "https://api.example.com/zitadel/oauth"), Platform: true},
		},
		{
			name:            "empty tenant with the public base's path as forwarded prefix",
			platformEnabled: true,
			publicBase:      "https://api.example.com/zitadel",
			host:            "api.example.com",
			headers:         map[string]string{"X-Forwarded-Proto": "https", "X-Forwarded-Prefix": "/zitadel"},
			want:            Issuer{ProjectID: domain.PlatformProjectID, URL: mustParseURL(t, "https://api.example.com/zitadel/oauth"), Platform: true},
		},
		{
			name:            "empty tenant with a forged prefix",
			platformEnabled: true,
			publicBase:      "https://api.example.com/zitadel",
			host:            "api.example.com",
			headers:         map[string]string{"X-Forwarded-Proto": "https", "X-Forwarded-Prefix": "/evil"},
			wantErr:         domain.ErrOriginInvalid(),
		},
		{
			name:            "empty tenant at another origin",
			platformEnabled: true,
			host:            "app.example.com",
			headers:         map[string]string{"X-Forwarded-Proto": "https"},
			wantErr:         domain.ErrOriginInvalid(),
		},
		{
			name:    "empty tenant without a platform project",
			host:    "api.example.com",
			wantErr: domain.ErrProjectNotFound(),
		},
		{
			name:            "the platform project's id is no tenant",
			platformEnabled: true,
			tenant:          domain.PlatformProjectID,
			host:            "api.example.com",
			wantErr:         domain.ErrProjectNotFound(),
		},
		{
			name:    "tenant is not a project id",
			tenant:  "evil",
			host:    "app.example.com",
			wantErr: domain.ErrProjectNotFound(),
		},
		{
			name:    "forged prefix",
			tenant:  "proj_123",
			host:    "app.example.com",
			headers: map[string]string{"X-Forwarded-Prefix": "/evil"},
			wantErr: domain.ErrOriginInvalid(),
		},
		{
			name:    "wildcard host",
			tenant:  "proj_123",
			host:    "*.example.com",
			headers: map[string]string{"X-Forwarded-Proto": "https"},
			wantErr: domain.ErrOriginInvalid(),
		},
		{
			name:    "no host",
			tenant:  "proj_123",
			wantErr: domain.ErrOriginInvalid(),
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			r.Host = tt.host
			for k, v := range tt.headers {
				r.Header.Set(k, v)
			}
			s := &server{platformEnabled: tt.platformEnabled, publicBase: mustParseURL(t, cmp.Or(tt.publicBase, "https://api.example.com"))}
			got, err := s.deriveIssuer(r, tt.tenant)
			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
				assert.Equal(t, Issuer{}, got)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}
