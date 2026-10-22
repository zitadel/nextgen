package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestMatchOrigin_LiteralBeatsWildcard(t *testing.T) {
	patterns := []domain.Origin{
		{Pattern: "https://*-acme.vercel.app", Kind: domain.OriginKindPreview},
		{Pattern: "https://app.acme.com", Kind: domain.OriginKindPrimary},
		{Pattern: "https://exact-acme.vercel.app", Kind: domain.OriginKindPreview},
	}

	got, ok := domain.MatchOrigin(patterns, "https://app.acme.com")
	require.True(t, ok)
	assert.Equal(t, domain.OriginKindPrimary, got.Kind)
	assert.Equal(t, "https://app.acme.com", got.Pattern)

	got, ok = domain.MatchOrigin(patterns, "https://exact-acme.vercel.app")
	require.True(t, ok)
	assert.Equal(t, "https://exact-acme.vercel.app", got.Pattern)

	got, ok = domain.MatchOrigin(patterns, "https://preview-acme.vercel.app")
	require.True(t, ok)
	assert.Equal(t, "https://*-acme.vercel.app", got.Pattern)

	_, ok = domain.MatchOrigin(patterns, "https://evil.example")
	assert.False(t, ok)
}

func TestMatchOrigin_WildcardDoesNotCrossLabels(t *testing.T) {
	patterns := []domain.Origin{
		{Pattern: "https://*-acme.vercel.app", Kind: domain.OriginKindPreview},
	}
	_, ok := domain.MatchOrigin(patterns, "https://a.b-acme.vercel.app")
	assert.False(t, ok)
}

func TestIsLoopbackOrigin(t *testing.T) {
	assert.True(t, domain.IsLoopbackOrigin("http://localhost:3000"))
	assert.True(t, domain.IsLoopbackOrigin("http://127.0.0.1"))
	assert.True(t, domain.IsLoopbackOrigin("http://[::1]:8080"))
	assert.False(t, domain.IsLoopbackOrigin("https://app.acme.com"))
}

func TestNormalizeOrigin(t *testing.T) {
	got, err := domain.NormalizeOrigin("HTTPS://App.Acme.COM")
	require.NoError(t, err)
	assert.Equal(t, "https://app.acme.com", got)

	_, err = domain.NormalizeOrigin("https://app.acme.com/path")
	assert.Error(t, err)
}
