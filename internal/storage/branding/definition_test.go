package branding_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/branding"
)

func TestMarshalAndToDomain(t *testing.T) {
	in := &domain.Branding{
		ProjectID:      "proj_1",
		ID:             "brnd_1",
		Layout:         domain.BrandingLayoutSplit,
		LiquidTemplate: `<zl-page-shell>{% mandatory_gates %}</zl-page-shell>`,
		LogoURL:        "https://cdn.example.com/logo.svg",
		FontURL:        "https://fonts.example.com/css2",
		HeroURL:        "https://cdn.example.com/hero.png",
		CreatedAt:      time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC),
	}

	raw, err := branding.Marshal(in)
	require.NoError(t, err)

	got, err := branding.ToDomain(in.ProjectID, in.ID, in.CreatedAt, raw)
	require.NoError(t, err)
	assert.Equal(t, in, got)
}
