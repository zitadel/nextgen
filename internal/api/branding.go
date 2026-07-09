package api

import (
	api "github.com/zitadel/nextgen/api/generated"
)

// defaultBranding returns the MVP layout fallback until the Branding API
// ships. The default login template is not sent from the server: it is
// bundled with @zitadel/components, and the orchestrator falls back to it
// whenever branding carries no liquid_template.
func defaultBranding() api.Branding {
	return api.Branding{
		Layout: api.NewOptBrandingLayout(api.BrandingLayoutCentered),
	}
}
