package api

import (
	_ "embed"

	api "github.com/zitadel/nextgen/api/generated"
)

//go:embed branding/default.liquid
var defaultLiquidTemplate string

// defaultBranding returns the MVP fallback until the Branding API ships.
func defaultBranding() api.Branding {
	return api.Branding{
		Layout:         api.NewOptBrandingLayout(api.BrandingLayoutCentered),
		LiquidTemplate: api.NewOptString(defaultLiquidTemplate),
	}
}
