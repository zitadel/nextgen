package domain_test

import (
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

	t.Run("preview wildcard on shared host accepted as written", func(t *testing.T) {
		t.Parallel()
		require.NoError(t, v.Validate(domain.Origin{
			Pattern: "https://*.vercel.app",
			Kind:    domain.OriginKindPreview,
		}))
		require.NoError(t, v.Validate(domain.Origin{
			Pattern: "https://*-acmeinc.vercel.app",
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

	t.Run("duplicate patterns", func(t *testing.T) {
		t.Parallel()
		err := v.ValidateAll([]domain.Origin{
			{Pattern: "https://app.example.com", Kind: domain.OriginKindPrimary},
			{Pattern: "https://app.example.com", Kind: domain.OriginKindPreview},
		})
		require.Error(t, err)
		assert.Equal(t, domain.ErrOriginKindConflict().Code, err.(domain.Error).Code)

		require.NoError(t, v.ValidateAll([]domain.Origin{
			{Pattern: "https://app.example.com", Kind: domain.OriginKindPrimary},
			{Pattern: "https://app.example.com", Kind: domain.OriginKindPrimary},
		}))
	})
}
