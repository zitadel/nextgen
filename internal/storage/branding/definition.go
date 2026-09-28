// Package branding holds shared encoding helpers for the branding definition
// JSON column used by v2 dialect statements.
package branding

import (
	"encoding/json"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// Definition is the structure stored inside the definition JSON/JSONB column.
//
// The appearance blocks carry the domain types directly rather than a mirror:
// they are twelve colours per theme side, and a second spelling of them here
// would drift silently. Their JSON tags are the wire names, so a stored
// definition reads the same as the request that published it.
type Definition struct {
	Layout         string                    `json:"layout"`
	LiquidTemplate string                    `json:"liquid_template,omitempty"`
	LogoURL        string                    `json:"logo_url,omitempty"`
	HeroURL        string                    `json:"hero_url,omitempty"`
	Theme          domain.BrandingTheme      `json:"theme,omitzero"`
	Typography     domain.BrandingTypography `json:"typography,omitzero"`
	Shape          domain.BrandingShape      `json:"shape,omitzero"`
}

// Marshal converts the domain branding content into JSON for the definition
// column.
func Marshal(b *domain.Branding) ([]byte, error) {
	return json.Marshal(Definition{
		Layout:         b.Layout,
		LiquidTemplate: b.LiquidTemplate,
		LogoURL:        b.LogoURL,
		HeroURL:        b.HeroURL,
		Theme:          b.Theme,
		Typography:     b.Typography,
		Shape:          b.Shape,
	})
}

// ToDomain converts scanned row columns plus the definition JSON payload into
// a domain.Branding. Revisions published before a field existed simply carry
// its zero value, which is the same thing as "use the maintained default".
func ToDomain(projectID, id string, createdAt time.Time, definition []byte) (*domain.Branding, error) {
	var def Definition
	if len(definition) > 0 {
		if err := json.Unmarshal(definition, &def); err != nil {
			return nil, err
		}
	}
	return &domain.Branding{
		ProjectID:      projectID,
		ID:             id,
		Layout:         def.Layout,
		LiquidTemplate: def.LiquidTemplate,
		LogoURL:        def.LogoURL,
		HeroURL:        def.HeroURL,
		Theme:          def.Theme,
		Typography:     def.Typography,
		Shape:          def.Shape,
		// Spanner returns UTC while pgx defaults to local; normalize to UTC.
		CreatedAt: createdAt.UTC(),
	}, nil
}
