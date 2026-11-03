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
		HeroURL:        "https://cdn.example.com/hero.png",
		Theme: domain.BrandingTheme{
			Mode:  domain.BrandingThemeAuto,
			Light: &domain.BrandingThemeSide{LogoURL: "https://cdn.example.com/on-light.svg"},
			Dark: &domain.BrandingThemeSide{
				LogoURL: "https://cdn.example.com/on-dark.svg",
				Palette: &domain.BrandingPalette{Primary: "#A5B4FC", Background: "#0A0A0A"},
			},
		},
		Typography: domain.BrandingTypography{
			FontFamily: "Inter, sans-serif",
			FontURL:    "https://fonts.example.com/css2",
			Scale:      1.1,
		},
		Shape: domain.BrandingShape{
			Radius:    domain.BrandingRadius{Pixels: new(10)},
			Density:   domain.BrandingDensityRegular,
			LogoScale: 1.5,
		},
		CreatedAt: time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC),
	}

	raw, err := branding.Marshal(in)
	require.NoError(t, err)

	got, err := branding.ToDomain(in.ProjectID, in.ID, in.CreatedAt, raw)
	require.NoError(t, err)
	assert.Equal(t, in, got)
}

// The definition column carries the wire spelling of a radius, so a stored
// revision reads the same as the request that published it.
func TestMarshalWritesRadiusTheWayTheWireCarriesIt(t *testing.T) {
	for _, tt := range []struct {
		name   string
		radius domain.BrandingRadius
		want   string
	}{
		{name: "preset", radius: domain.BrandingRadius{Preset: domain.BrandingRadiusLg}, want: `"radius":"lg"`},
		{name: "pixels", radius: domain.BrandingRadius{Pixels: new(10)}, want: `"radius":10`},
		{name: "zero pixels", radius: domain.BrandingRadius{Pixels: new(0)}, want: `"radius":0`},
	} {
		t.Run(tt.name, func(t *testing.T) {
			raw, err := branding.Marshal(&domain.Branding{
				Layout: domain.BrandingLayoutCentered,
				Shape:  domain.BrandingShape{Radius: tt.radius},
			})
			require.NoError(t, err)
			assert.Contains(t, string(raw), tt.want)
		})
	}
}

// An unset radius must not persist as an empty string that would come back as
// an unknown preset on the next read.
func TestMarshalOmitsUnsetAppearance(t *testing.T) {
	raw, err := branding.Marshal(&domain.Branding{Layout: domain.BrandingLayoutCentered})
	require.NoError(t, err)
	assert.NotContains(t, string(raw), "radius")
	assert.NotContains(t, string(raw), "theme")
	assert.NotContains(t, string(raw), "typography")
	assert.NotContains(t, string(raw), "shape")
}

// Revisions published before the appearance fields existed still read back.
func TestToDomainAcceptsRevisionsWithoutAppearance(t *testing.T) {
	got, err := branding.ToDomain("proj_1", "brnd_1", time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC),
		[]byte(`{"layout":"centered","logo_url":"https://cdn.example.com/logo.svg"}`))
	require.NoError(t, err)
	assert.Equal(t, domain.BrandingTheme{}, got.Theme)
	assert.Equal(t, domain.BrandingTypography{}, got.Typography)
	assert.Equal(t, domain.BrandingShape{}, got.Shape)
	assert.True(t, got.Shape.Radius.IsZero())
}
