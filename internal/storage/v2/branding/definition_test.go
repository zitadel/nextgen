package branding_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/branding"
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
	assert.Contains(t, string(raw), `"layout":"split"`)
	assert.Contains(t, string(raw), `"liquid_template"`)

	got, err := branding.ToDomain(in.ProjectID, in.ID, in.CreatedAt, raw)
	require.NoError(t, err)
	assert.Equal(t, in, got)
}

func TestToDomainEmptyDefinition(t *testing.T) {
	got, err := branding.ToDomain("proj_1", "brnd_1", time.Unix(0, 0).UTC(), nil)
	require.NoError(t, err)
	assert.Equal(t, "proj_1", got.ProjectID)
	assert.Equal(t, "brnd_1", got.ID)
	assert.Empty(t, got.Layout)
}
