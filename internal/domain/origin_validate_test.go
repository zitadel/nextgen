package domain_test

import (
	"regexp"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestOriginValidator(t *testing.T) {
	t.Parallel()
	v := domain.OriginValidator{SharedHosts: domain.DefaultSharedHosts}

	t.Run("primary exact", func(t *testing.T) {
		t.Parallel()
		require.NoError(t, v.Validate(domain.Origin{
			Pattern: "https://app.example.com",
			Kind:    domain.OriginKindPrimary,
		}))
	})

	t.Run("primary with port", func(t *testing.T) {
		t.Parallel()
		require.NoError(t, v.Validate(domain.Origin{
			Pattern: "http://localhost:3000",
			Kind:    domain.OriginKindPrimary,
		}))
	})

	t.Run("primary with wildcard", func(t *testing.T) {
		t.Parallel()
		err := v.Validate(domain.Origin{
			Pattern: "https://*.example.com",
			Kind:    domain.OriginKindPrimary,
		})
		require.Error(t, err)
		assert.Equal(t, domain.ErrOriginPrimaryNotExact().Code, err.(domain.Error).Code)
	})

	t.Run("preview wildcard on unknown host", func(t *testing.T) {
		t.Parallel()
		require.NoError(t, v.Validate(domain.Origin{
			Pattern: "https://*.preview.example.com",
			Kind:    domain.OriginKindPreview,
		}))
	})

	t.Run("unbounded vercel", func(t *testing.T) {
		t.Parallel()
		err := v.Validate(domain.Origin{
			Pattern: "https://*.vercel.app",
			Kind:    domain.OriginKindPreview,
		})
		require.Error(t, err)
		assert.Equal(t, domain.ErrOriginUnbounded().Code, err.(domain.Error).Code)
	})

	t.Run("bounded vercel", func(t *testing.T) {
		t.Parallel()
		require.NoError(t, v.Validate(domain.Origin{
			Pattern: "https://*-acmeinc.vercel.app",
			Kind:    domain.OriginKindPreview,
		}))
	})

	t.Run("unbounded netlify", func(t *testing.T) {
		t.Parallel()
		err := v.Validate(domain.Origin{
			Pattern: "https://*.netlify.app",
			Kind:    domain.OriginKindPreview,
		})
		require.Error(t, err)
		assert.Equal(t, domain.ErrOriginUnbounded().Code, err.(domain.Error).Code)
	})

	t.Run("bounded netlify", func(t *testing.T) {
		t.Parallel()
		require.NoError(t, v.Validate(domain.Origin{
			Pattern: "https://*--acme-site.netlify.app",
			Kind:    domain.OriginKindPreview,
		}))
	})

	t.Run("bounded pages.dev", func(t *testing.T) {
		t.Parallel()
		require.NoError(t, v.Validate(domain.Origin{
			Pattern: "https://*.acme-app.pages.dev",
			Kind:    domain.OriginKindPreview,
		}))
	})

	t.Run("unbounded pages.dev", func(t *testing.T) {
		t.Parallel()
		err := v.Validate(domain.Origin{
			Pattern: "https://*.pages.dev",
			Kind:    domain.OriginKindPreview,
		})
		require.Error(t, err)
		assert.Equal(t, domain.ErrOriginUnbounded().Code, err.(domain.Error).Code)
	})

	t.Run("bounded workers.dev", func(t *testing.T) {
		t.Parallel()
		require.NoError(t, v.Validate(domain.Origin{
			Pattern: "https://*.acmeinc.workers.dev",
			Kind:    domain.OriginKindPreview,
		}))
	})

	t.Run("malformed", func(t *testing.T) {
		t.Parallel()
		cases := []string{
			"",
			"HTTPS://APP.EXAMPLE.COM",
			"https://app.example.com/path",
			"https://app.example.com/",
			"ftp://app.example.com",
			"not-a-url",
			"https://*.*.example.com",
		}
		for _, pattern := range cases {
			err := v.Validate(domain.Origin{Pattern: pattern, Kind: domain.OriginKindPreview})
			require.Error(t, err, pattern)
			assert.Equal(t, domain.ErrOriginInvalid().Code, err.(domain.Error).Code, pattern)
		}
	})

	t.Run("empty shared hosts skips unbounded", func(t *testing.T) {
		t.Parallel()
		empty := domain.OriginValidator{SharedHosts: nil}
		require.NoError(t, empty.Validate(domain.Origin{
			Pattern: "https://*.vercel.app",
			Kind:    domain.OriginKindPreview,
		}))
	})

	t.Run("shared hosts replace not merge", func(t *testing.T) {
		t.Parallel()
		onlyPages := domain.OriginValidator{SharedHosts: map[string]*regexp.Regexp{
			"pages.dev": regexp.MustCompile(domain.DefaultSharedHostPatterns["pages.dev"]),
		}}
		require.NoError(t, onlyPages.Validate(domain.Origin{
			Pattern: "https://*.vercel.app",
			Kind:    domain.OriginKindPreview,
		}))
		err := onlyPages.Validate(domain.Origin{
			Pattern: "https://*.pages.dev",
			Kind:    domain.OriginKindPreview,
		})
		require.Error(t, err)
		assert.Equal(t, domain.ErrOriginUnbounded().Code, err.(domain.Error).Code)
	})

	t.Run("custom shared host allow regexp", func(t *testing.T) {
		t.Parallel()
		custom := domain.OriginValidator{SharedHosts: map[string]*regexp.Regexp{
			"preview.example.com": regexp.MustCompile(`^\*\.tenant\.preview\.example\.com$`),
		}}
		require.NoError(t, custom.Validate(domain.Origin{
			Pattern: "https://*.tenant.preview.example.com",
			Kind:    domain.OriginKindPreview,
		}))
		err := custom.Validate(domain.Origin{
			Pattern: "https://*.preview.example.com",
			Kind:    domain.OriginKindPreview,
		})
		require.Error(t, err)
		assert.Equal(t, domain.ErrOriginUnbounded().Code, err.(domain.Error).Code)
	})
}
