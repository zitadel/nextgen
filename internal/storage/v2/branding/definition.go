// Package branding holds shared encoding helpers for the branding definition
// JSON column used by v2 dialect statements.
package branding

import (
	"encoding/json"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// Definition is the structure stored inside the definition JSON/JSONB column.
type Definition struct {
	Layout         string `json:"layout"`
	LiquidTemplate string `json:"liquid_template,omitempty"`
	LogoURL        string `json:"logo_url,omitempty"`
	FontURL        string `json:"font_url,omitempty"`
	HeroURL        string `json:"hero_url,omitempty"`
}

// Marshal converts the domain branding content into JSON for the definition
// column.
func Marshal(b *domain.Branding) ([]byte, error) {
	return json.Marshal(Definition{
		Layout:         b.Layout,
		LiquidTemplate: b.LiquidTemplate,
		LogoURL:        b.LogoURL,
		FontURL:        b.FontURL,
		HeroURL:        b.HeroURL,
	})
}

// ToDomain converts scanned row columns plus the definition JSON payload into
// a domain.Branding.
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
		FontURL:        def.FontURL,
		HeroURL:        def.HeroURL,
		// Spanner returns UTC while pgx defaults to local; normalize to UTC.
		CreatedAt: createdAt.UTC(),
	}, nil
}
