package api

import (
	_ "embed"

	api "github.com/zitadel/nextgen/api/generated"
)

//go:embed branding/default.liquid
var defaultLiquidTemplate string

// defaultBranding returns the MVP branding payload — a hard-coded
// centered layout plus the embedded default LiquidJS template. Team /
// app overrides land later behind the Branding API.
func defaultBranding() api.Branding {
	return api.Branding{
		Layout:         api.NewOptBrandingLayout(api.BrandingLayoutCentered),
		LiquidTemplate: api.NewOptString(defaultLiquidTemplate),
	}
}
