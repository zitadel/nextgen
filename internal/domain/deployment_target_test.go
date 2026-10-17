package domain

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var projectOrigins = []Origin{
	{Pattern: "https://www.acme.com", Kind: OriginKindPrimary},
	{Pattern: "https://app.acme.com", Kind: OriginKindPrimary},
	{Pattern: "https://*-acmeinc.vercel.app", Kind: OriginKindPreview},
	{Pattern: "http://localhost:3000", Kind: OriginKindPreview},
}

func TestOriginMatches(t *testing.T) {
	pattern := Origin{Pattern: "https://*-acmeinc.vercel.app", Kind: OriginKindPreview}
	for origin, want := range map[string]bool{
		"https://acme-git-sso-acmeinc.vercel.app":   true,
		"https://-acmeinc.vercel.app":               false,
		"https://a.b-acmeinc.vercel.app":            false,
		"http://acme-git-sso-acmeinc.vercel.app":    false,
		"https://acme-git-sso-acmeinc.vercel.app:1": false,
		"https://acme-git-sso-other.vercel.app":     false,
	} {
		assert.Equal(t, want, pattern.Matches(origin), origin)
	}
	assert.True(t, Origin{Pattern: "https://app.acme.com"}.Matches("https://app.acme.com"))
}

func TestResolveDeploymentTargets(t *testing.T) {
	t.Run("primary expands to every primary origin", func(t *testing.T) {
		kind, origins, err := ResolveDeploymentTargets(projectOrigins, []string{DeploymentTargetPrimary})
		require.NoError(t, err)
		assert.Equal(t, DeploymentOriginKindPrimary, kind)
		assert.Equal(t, []string{"https://www.acme.com", "https://app.acme.com"}, origins)
	})

	t.Run("an exact primary origin", func(t *testing.T) {
		kind, origins, err := ResolveDeploymentTargets(projectOrigins, []string{"https://app.acme.com"})
		require.NoError(t, err)
		assert.Equal(t, DeploymentOriginKindPrimary, kind)
		assert.Equal(t, []string{"https://app.acme.com"}, origins)
	})

	t.Run("preview URLs", func(t *testing.T) {
		kind, origins, err := ResolveDeploymentTargets(projectOrigins, []string{"https://acme-git-sso-acmeinc.vercel.app"})
		require.NoError(t, err)
		assert.Equal(t, DeploymentOriginKindPreview, kind)
		assert.Equal(t, []string{"https://acme-git-sso-acmeinc.vercel.app"}, origins)
	})

	t.Run("mixing kinds", func(t *testing.T) {
		_, _, err := ResolveDeploymentTargets(projectOrigins, []string{DeploymentTargetPrimary, "https://acme-git-sso-acmeinc.vercel.app"})
		assert.Equal(t, ErrDeploymentInvalid(nil, nil).Code, err.(Error).Code)
	})

	t.Run("primary with no primary origin", func(t *testing.T) {
		_, _, err := ResolveDeploymentTargets(projectOrigins[2:], []string{DeploymentTargetPrimary})
		assert.Equal(t, ErrDeploymentInvalid(nil, nil).Code, err.(Error).Code)
	})

	t.Run("an origin the project does not allow", func(t *testing.T) {
		_, _, err := ResolveDeploymentTargets(projectOrigins, []string{"https://evil.example"})
		assert.Equal(t, ErrProjectOriginNotAllowed("").Code, err.(Error).Code)
	})

	t.Run("a loopback origin is never a preview", func(t *testing.T) {
		_, _, err := ResolveDeploymentTargets(projectOrigins, []string{"http://localhost:3000"})
		assert.Equal(t, ErrProjectOriginNotAllowed("").Code, err.(Error).Code)
	})
}

func TestCheckPrimaryOrigins(t *testing.T) {
	require.NoError(t, CheckPrimaryOrigins(projectOrigins, []string{"https://app.acme.com"}))
	err := CheckPrimaryOrigins(projectOrigins, []string{"https://app.acme.com", "https://acme-git-sso-acmeinc.vercel.app"})
	assert.Equal(t, ErrProjectOriginNotAllowed("").Code, err.(Error).Code)
}

func TestParsePreviewTTL(t *testing.T) {
	for ttl, want := range map[string]time.Duration{
		"30m":  30 * time.Minute,
		"168h": 168 * time.Hour,
		"7d":   7 * 24 * time.Hour,
	} {
		got, err := ParsePreviewTTL(ttl)
		require.NoError(t, err, ttl)
		assert.Equal(t, want, got, ttl)
	}
	for _, ttl := range []string{"", "h", "0h", "7w", "-1h"} {
		_, err := ParsePreviewTTL(ttl)
		assert.Error(t, err, ttl)
	}
}
