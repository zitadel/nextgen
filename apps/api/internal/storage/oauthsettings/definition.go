// Package oauthsettings holds the shared encoding helpers for the OAuth
// settings definition JSON column used by the dialect statements.
package oauthsettings

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// definition is the structure stored inside the definition JSON/JSONB
// column. Its JSON tag is the wire name, so a stored definition reads the
// same as the bundle resource that published it.
type definition struct {
	Enabled bool `json:"enabled"`
}

// MarshalDefinition encodes the OAuth settings content for the definition
// column. The service builds the revision, so a nil one here is a server
// fault.
func MarshalDefinition(s *domain.OAuthSettings) ([]byte, error) {
	if s == nil {
		return nil, domain.ErrInternal(errors.New("oauth settings revision is nil"))
	}
	return json.Marshal(definition{Enabled: s.Enabled})
}

// ToDomain converts scanned row columns plus the definition JSON payload
// into a domain.OAuthSettings.
func ToDomain(projectID, id string, createdAt time.Time, raw []byte) (*domain.OAuthSettings, error) {
	var def definition
	if err := json.Unmarshal(raw, &def); err != nil {
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
