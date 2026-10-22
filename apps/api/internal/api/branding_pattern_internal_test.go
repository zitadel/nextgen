package api

import (
	"testing"

	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// The OpenAPI `pattern` on the appearance values is deliberately a superset of
// the domain allowlist: a regex cannot balance parentheses, so it pins the
// shape and the domain decides which of those shapes is a colour function it
// will run.
//
// Superset is the direction that has to hold. A pattern looser than the gate
// only means a caller gets the server's error instead of the client's; a
// pattern tighter than the gate rejects a colour the server would have stored,
// in generated clients we do not control. These tests pin that direction, so
// the two cannot drift apart in the wrong one.
func TestBrandingColorPatternAcceptsEverythingTheGateDoes(t *testing.T) {
	for _, value := range []string{
		"#fff",
		"#FFFF",
		"#4F46E5",
		"#4F46E5CC",
		"red",
		"RebeccaPurple",
		"currentColor",
		"transparent",
		"rgb(79 70 229)",
		"rgb(79, 70, 229)",
		"rgba(79 70 229 / 50%)",
		"hsl(243deg 75% 59%)",
		"oklch(0.7 0.15 250)",
		"color(display-p3 0.3 0.2 0.9)",
		"color-mix(in oklab, #4F46E5 40%, white)",
		"color-mix(in srgb, rgb(1 2 3), red)",
	} {
		t.Run(value, func(t *testing.T) {
			require.NoError(t, domain.ValidateBrandingColor("palette.primary", value),
				"fixture is not a colour the gate accepts")
			palette := api.BrandingPalette{Primary: api.NewOptBrandingColor(api.BrandingColor(value))}
			require.NoError(t, palette.Validate(),
				"the contract pattern rejects a colour the server would store")
		})
	}
}

// The pattern carries the half of the gate that keeps a value inside its own
// CSS declaration, so generated clients refuse an injection without reaching
// the server at all.
func TestBrandingColorPatternRejectsInjection(t *testing.T) {
	for name, value := range map[string]string{
		"closes the declaration": "red; } :host { display: none",
		"opens a block":          "red } :host {",
		"comment escape":         "red /* } */",
		"fetches a url":          "url(https://evil.example/beacon.png)",
		"backslash escape":       `\72 ed`,
		"newline":                "red;\n} :host { display: none",
	} {
		t.Run(name, func(t *testing.T) {
			palette := api.BrandingPalette{Primary: api.NewOptBrandingColor(api.BrandingColor(value))}
			require.Error(t, palette.Validate())
		})
	}
}

func TestBrandingFontFamilyPatternAcceptsEverythingTheGateDoes(t *testing.T) {
	for _, value := range []string{
		"Inter",
		"Inter, ui-sans-serif, sans-serif",
		"Helvetica Neue, Arial, sans-serif",
		`"APK Futural", Arimo, ui-sans-serif, system-ui, sans-serif`,
		"'Fira Code', ui-monospace, monospace",
	} {
		t.Run(value, func(t *testing.T) {
			require.NoError(t, domain.ValidateBrandingFontFamily(value),
				"fixture is not a stack the gate accepts")
			typography := api.BrandingTypography{FontFamily: api.NewOptString(value)}
			require.NoError(t, typography.Validate(),
				"the contract pattern rejects a font stack the server would store")
		})
	}
}

func TestBrandingFontFamilyPatternRejectsInjection(t *testing.T) {
	for name, value := range map[string]string{
		"closes the declaration": "Inter; } :host { display: none",
		"unterminated quote":     `"Inter`,
		"escape sequence":        `Inter\3b `,
	} {
		t.Run(name, func(t *testing.T) {
			typography := api.BrandingTypography{FontFamily: api.NewOptString(value)}
			require.Error(t, typography.Validate())
		})
	}
}
