package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeOrigin(t *testing.T) {
	for _, tc := range []struct {
		raw  string
		want string
		ok   bool
	}{
		{"https://App.Acme.com", "https://app.acme.com", true},
		{" http://localhost:3000 ", "http://localhost:3000", true},
		{"https://*-acmeinc.vercel.app", "https://*-acmeinc.vercel.app", true},
		{"http://[::1]:3000", "http://[::1]:3000", true},
		{"app.acme.com", "", false},
		{"ftp://app.acme.com", "", false},
		{"https://app.acme.com/login", "", false},
		{"https://app.acme.com?x=1", "", false},
		{"https://user@app.acme.com", "", false},
		{"https://app.acme.com:abc", "", false},
		{"https://", "", false},
		{"https://.acme.com", "", false},
	} {
		got, err := NormalizeOrigin(tc.raw)
		if tc.ok {
			require.NoError(t, err, tc.raw)
			assert.Equal(t, tc.want, got)
		} else {
			assert.Error(t, err, tc.raw)
		}
	}
}

func TestMatchOrigin(t *testing.T) {
	patterns := []Origin{
		{Pattern: "https://*-acmeinc.vercel.app", Kind: OriginKindPreview},
		{Pattern: "https://app.acme.com", Kind: OriginKindPrimary},
		{Pattern: "https://*.preview.acme.com", Kind: OriginKindPreview},
		{Pattern: "https://app.acme.com:8443", Kind: OriginKindPrimary},
	}

	t.Run("literal match", func(t *testing.T) {
		got, ok := MatchOrigin(patterns, "https://app.acme.com")
		require.True(t, ok)
		assert.Equal(t, OriginKindPrimary, got.Kind)
	})

	t.Run("literal beats wildcard whatever the order", func(t *testing.T) {
		ordered := []Origin{
			{Pattern: "https://*.acme.com", Kind: OriginKindPreview},
			{Pattern: "https://app.acme.com", Kind: OriginKindPrimary},
		}
		got, ok := MatchOrigin(ordered, "https://app.acme.com")
		require.True(t, ok)
		assert.Equal(t, "https://app.acme.com", got.Pattern)
	})

	t.Run("wildcard inside a label", func(t *testing.T) {
		got, ok := MatchOrigin(patterns, "https://acme-git-sso-acmeinc.vercel.app")
		require.True(t, ok)
		assert.Equal(t, "https://*-acmeinc.vercel.app", got.Pattern)
		_, ok = MatchOrigin(patterns, "https://evil-acmeinc.vercel.app")
		assert.True(t, ok, "a stranger matching the pattern is the row's problem, not the matcher's")
		_, ok = MatchOrigin(patterns, "https://acme-xyz-attacker.vercel.app")
		assert.False(t, ok)
	})

	t.Run("a star never crosses a dot", func(t *testing.T) {
		_, ok := MatchOrigin(patterns, "https://a.b.preview.acme.com")
		assert.False(t, ok)
		_, ok = MatchOrigin(patterns, "https://sso.preview.acme.com")
		assert.True(t, ok)
		_, ok = MatchOrigin(patterns, "https://.preview.acme.com")
		assert.False(t, ok, "a star takes at least one character")
	})

	t.Run("scheme and port are literal", func(t *testing.T) {
		_, ok := MatchOrigin(patterns, "http://app.acme.com")
		assert.False(t, ok)
		_, ok = MatchOrigin(patterns, "https://app.acme.com:8443")
		assert.True(t, ok)
		_, ok = MatchOrigin(patterns, "https://app.acme.com:9443")
		assert.False(t, ok)
	})

	t.Run("case-insensitive on the request side", func(t *testing.T) {
		_, ok := MatchOrigin(patterns, "HTTPS://APP.ACME.COM")
		assert.True(t, ok)
	})

	t.Run("empty", func(t *testing.T) {
		_, ok := MatchOrigin(patterns, "")
		assert.False(t, ok)
		_, ok = MatchOrigin(nil, "https://app.acme.com")
		assert.False(t, ok)
	})
}

func TestIsLoopbackOrigin(t *testing.T) {
	assert.True(t, IsLoopbackOrigin("http://localhost:3000"))
	assert.True(t, IsLoopbackOrigin("http://project-a.localhost:3000"))
	assert.True(t, IsLoopbackOrigin("http://127.0.0.1"))
	assert.True(t, IsLoopbackOrigin("http://[::1]:3000"))
	assert.False(t, IsLoopbackOrigin("https://app.acme.com"))
	assert.False(t, IsLoopbackOrigin("https://localhost.acme.com"))
}

func TestLintOriginPattern(t *testing.T) {
	type tc struct {
		name    string
		mode    ProjectMode
		entry   Origin
		wantErr string
		wantWrn string
	}
	for _, c := range []tc{
		{"production literal primary", ProjectModeProduction, Origin{"https://app.acme.com", OriginKindPrimary}, "", ""},
		{"production wildcard primary", ProjectModeProduction, Origin{"https://*.acme.com", OriginKindPrimary}, "origin.not_permitted_for_mode", ""},
		{"production loopback", ProjectModeProduction, Origin{"http://localhost:3000", OriginKindPrimary}, "origin.not_permitted_for_mode", ""},
		{"production loopback preview", ProjectModeProduction, Origin{"http://localhost:3000", OriginKindPreview}, "origin.not_permitted_for_mode", ""},
		{"sandbox loopback", ProjectModeSandbox, Origin{"http://localhost:3000", OriginKindPrimary}, "", ""},
		{"sandbox wildcard primary", ProjectModeSandbox, Origin{"https://*.acme.com", OriginKindPrimary}, "", "origin_host_unknown"},
		{"vercel bounded", ProjectModeProduction, Origin{"https://*-acmeinc.vercel.app", OriginKindPreview}, "", ""},
		{"vercel unbounded", ProjectModeProduction, Origin{"https://*.vercel.app", OriginKindPreview}, "origin.unbounded", ""},
		{"vercel unbounded on sandbox warns", ProjectModeSandbox, Origin{"https://*.vercel.app", OriginKindPreview}, "", "origin_unbounded"},
		{"netlify bounded", ProjectModeProduction, Origin{"https://*--acme-site.netlify.app", OriginKindPreview}, "", ""},
		{"netlify unbounded", ProjectModeProduction, Origin{"https://*-acme.netlify.app", OriginKindPreview}, "origin.unbounded", ""},
		{"pages bounded", ProjectModeProduction, Origin{"https://*.acme-app.pages.dev", OriginKindPreview}, "", ""},
		{"pages unbounded", ProjectModeProduction, Origin{"https://*.pages.dev", OriginKindPreview}, "origin.unbounded", ""},
		{"workers bounded", ProjectModeProduction, Origin{"https://*.acmeinc.workers.dev", OriginKindPreview}, "", ""},
		{"own domain warns", ProjectModeProduction, Origin{"https://*.preview.acme.com", OriginKindPreview}, "", "origin_host_unknown"},
		{"malformed", ProjectModeSandbox, Origin{"acme.com", OriginKindPreview}, "origin.invalid", ""},
	} {
		t.Run(c.name, func(t *testing.T) {
			warning, err := LintOriginPattern(c.mode, c.entry)
			if c.wantErr != "" {
				require.Error(t, err)
				de, ok := err.(Error)
				require.True(t, ok)
				assert.Equal(t, c.wantErr, de.Code)
				return
			}
			require.NoError(t, err)
			if c.wantWrn == "" {
				assert.Nil(t, warning)
				return
			}
			require.NotNil(t, warning)
			assert.Equal(t, c.wantWrn, warning.Code)
		})
	}
}
