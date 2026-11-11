// Package oauthsettings holds the shared encoding helpers for the OAuth
// settings definition JSON column used by the dialect statements.
package oauthsettings

import (
	"encoding/json"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// Definition is the structure stored inside the definition JSON/JSONB
// column. Its JSON tag is the wire name, so a stored definition reads the
// same as the bundle resource that published it.
type Definition struct {
	Enabled bool `json:"enabled"`
}

// Marshal converts the domain OAuth settings content into JSON for the
// definition column.
func Marshal(s *domain.OAuthSettings) ([]byte, error) {
	return json.Marshal(Definition{Enabled: s.Enabled})
}

// ToDomain converts scanned row columns plus the definition JSON payload
// into a domain.OAuthSettings.
func ToDomain(projectID, id string, createdAt time.Time, definition []byte) (*domain.OAuthSettings, error) {
	var def Definition
	if err := json.Unmarshal(definition, &def); err != nil {
		return nil, err
	}
	return &domain.OAuthSettings{
		ProjectID: projectID,
		ID:        id,
		Enabled:   def.Enabled,
		// Spanner returns UTC while pgx defaults to local; normalize to UTC.
		CreatedAt: createdAt.UTC(),
	}, nil
}
