package api

import (
	"context"
	"testing"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// The wire mapping is the only place the appearance blocks change shape, so it
// is pinned in both directions at once: a revision that survives the round trip
// is one a client can read back exactly as it published it.
func TestBrandingAppearanceRoundTrip(t *testing.T) {
	in := &domain.Branding{
		ProjectID: "proj_a",
		ID:        "brnd_a",
		Layout:    domain.BrandingLayoutCentered,
		LogoURL:   "https://cdn.example.com/logo.svg",
		Theme: domain.BrandingTheme{
			Mode:  domain.BrandingThemeAuto,
			Light: &domain.BrandingThemeSide{LogoURL: "https://cdn.example.com/on-light.svg"},
			Dark: &domain.BrandingThemeSide{
				LogoURL: "https://cdn.example.com/on-dark.svg",
				Palette: &domain.BrandingPalette{Primary: "#A5B4FC", Text: "#FAFAFA"},
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
	}

	out := toAPIBranding(in)
	require.Equal(t, in.Theme, brandingThemeFromAPI(out.Theme))
	require.Equal(t, in.Typography, brandingTypographyFromAPI(out.Typography))
	require.Equal(t, in.Shape, brandingShapeFromAPI(out.Shape))
	require.Equal(t, in.Typography.FontURL, optURIString(out.Typography.Value.FontURL))
}

func TestBrandingRadiusPresetRoundTrip(t *testing.T) {
	in := &domain.Branding{
		Layout: domain.BrandingLayoutCentered,
		Shape:  domain.BrandingShape{Radius: domain.BrandingRadius{Preset: domain.BrandingRadiusLg}},
	}
	require.Equal(t, in.Shape, brandingShapeFromAPI(toAPIBranding(in).Shape))
}

// A published side with nothing on it still has to reach the client: which
// sides exist is what decides the themes a widget may resolve to.
func TestBrandingEmptyPublishedSideSurvives(t *testing.T) {
	in := &domain.Branding{
		Layout: domain.BrandingLayoutCentered,
		Theme:  domain.BrandingTheme{Dark: &domain.BrandingThemeSide{}},
	}
	out := toAPIBranding(in)
	require.True(t, out.Theme.Set)
	require.True(t, out.Theme.Value.Dark.Set)
	require.False(t, out.Theme.Value.Light.Set)
	require.Equal(t, in.Theme, brandingThemeFromAPI(out.Theme))
}

// A revision that sets nothing must not emit empty appearance objects — an
// absent block is how a client reads "the maintained defaults apply".
func TestBrandingWithoutAppearanceStaysUnset(t *testing.T) {
	out := toAPIBranding(&domain.Branding{Layout: domain.BrandingLayoutCentered})
	require.False(t, out.Theme.Set)
	require.False(t, out.Typography.Set)
	require.False(t, out.Shape.Set)
}

// Pins the branding resource-flavored answers through the resolver gate.
func TestBrandingAccessRow(t *testing.T) {
	stmts := stubAuthzStmts{}
	operator := WithScopeContext(context.Background(), ScopeContext{
		ProjectID:     "proj_a",
		Scope:         []string{"project.write", "project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj,
		PrincipalID:   "proj_a",
	})
	preview := WithScopeContext(context.Background(), ScopeContext{
		ProjectID:     "proj_a",
		Scope:         []string{"project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj,
		PrincipalID:   "proj_a",
	})

	if err := requireProjectAccess(operator, stmts, "proj_a", brandingAccess, opWrite); err != nil {
		t.Fatalf("own-project write with the project secret should pass: %v", err)
	}
	assertDomainCode(t, requireProjectAccess(operator, stmts, "proj_b", brandingAccess, opWrite),
		domain.ErrBrandingInvalid(nil, nil).Code)
	assertDomainCode(t, requireProjectAccess(operator, stmts, "proj_b", brandingAccess, opRead),
		domain.ErrBrandingNotFound().Code)
	assertDomainCode(t, requireProjectAccess(preview, stmts, "proj_a", brandingAccess, opWrite),
		domain.ErrBrandingPermissionDenied().Code)
	assertDomainCode(t, requireProjectAccess(preview, stmts, "proj_a", brandingAccess, opRead),
		domain.ErrBrandingPermissionDenied().Code)
}

// `default:` in the schema is materialised by ogen inside Decode, so a default
// on an optional field would arrive Set on a body that never carried it — and
// the revision would persist a value the caller did not choose. The contract
// states these defaults in prose for that reason; this pins the consequence.
func TestBrandingOmittedScalesStayUnset(t *testing.T) {
	var body api.Branding
	require.NoError(t, body.Decode(jx.DecodeStr(`{"shape":{"radius":10},"typography":{"font_family":"Inter"}}`)))

	require.False(t, body.Shape.Value.LogoScale.Set, "logo_scale should not be set by a default")
	require.False(t, body.Typography.Value.Scale.Set, "scale should not be set by a default")

	require.Zero(t, brandingShapeFromAPI(body.Shape).LogoScale)
	require.Zero(t, brandingTypographyFromAPI(body.Typography).Scale)
}
