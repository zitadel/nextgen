package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestMatchOrigin(t *testing.T) {
	t.Parallel()

	tests := []struct {
		pattern, origin string
		want            bool
	}{
		{"https://app.example.com", "https://app.example.com", true},
		{"https://app.example.com", "https://APP.example.com", true},
		{"https://app.example.com", "http://app.example.com", false},
		{"http://localhost:3000", "http://localhost:3000", true},
		{"http://localhost:3000", "http://localhost:3001", false},
		{"http://localhost:3000", "http://127.0.0.1:3000", false},
		{"https://*.vercel.app", "https://my-app-git-feat-sso-acme.vercel.app", true},
		{"https://*.vercel.app", "https://my-app-abc123-acme.vercel.app", true},
		{"https://*.vercel.app", "https://vercel.app", false},
		{"https://*.vercel.app", "https://a.b.vercel.app", false},
		{"https://*.vercel.app", "http://my-app.vercel.app", false},
		{"https://*.vercel.app", "https://my-app.vercel.app.evil.com", false},
		{"https://*.preview.example.com:8443", "https://pr-42.preview.example.com:8443", true},
		{"https://*.preview.example.com:8443", "https://pr-42.preview.example.com", false},
		{"", "https://app.example.com", false},
		{"https://*.vercel.app", "", false},
	}
	for _, tc := range tests {
		t.Run(tc.pattern+" vs "+tc.origin, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tc.want, domain.MatchOrigin(tc.pattern, tc.origin))
		})
	}
}

func TestNormalizeOriginPattern(t *testing.T) {
	t.Parallel()

	for _, ok := range []string{
		"https://app.example.com",
		"  HTTPS://App.Example.com ",
		"http://localhost:3000",
		"https://*.vercel.app",
		"https://*.preview.example.com:8443",
	} {
		got, err := domain.NormalizeOriginPattern(ok)
		require.NoError(t, err, ok)
		assert.NotContains(t, got, " ")
		assert.Equal(t, got, string([]byte(got)))
	}
	for _, bad := range []string{
		"app.example.com",
		"https://app.example.com/path",
		"https://app.*.example.com",
		"https://*",
		"https://*.",
		"https://**.vercel.app",
		"https://x*.vercel.app",
		"ftp://app.example.com",
	} {
		_, err := domain.NormalizeOriginPattern(bad)
		assert.Error(t, err, bad)
	}
}
