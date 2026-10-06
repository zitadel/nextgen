package project

import (
	"encoding/json"

	"github.com/zitadel/nextgen/internal/domain"
)

// allowedOrigin is the stored shape of one allowlist entry. Kind is written
// as its wire string so a row explains itself without the enum that wrote it.
type allowedOrigin struct {
	Pattern string `json:"pattern"`
	Kind    string `json:"kind"`
}

// MarshalAllowedOrigins renders the allowlist for the allowed_origins column.
// An empty list is stored as `[]`, never NULL: the column is NOT NULL and an
// empty allowlist is an answer (allow everything on a sandbox).
func MarshalAllowedOrigins(origins []domain.AllowedOrigin) ([]byte, error) {
	encoded := make([]allowedOrigin, 0, len(origins))
	for _, origin := range origins {
		encoded = append(encoded, allowedOrigin{Pattern: origin.Pattern, Kind: origin.Kind.String()})
	}
	return json.Marshal(encoded)
}

// UnmarshalAllowedOrigins reads the column back. Never nil, so a project with
// no patterns carries an empty list.
func UnmarshalAllowedOrigins(raw []byte) ([]domain.AllowedOrigin, error) {
	origins := []domain.AllowedOrigin{}
	if len(raw) == 0 || string(raw) == "null" {
		return origins, nil
	}
	var stored []allowedOrigin
	if err := json.Unmarshal(raw, &stored); err != nil {
		return nil, err
	}
	for _, entry := range stored {
		kind, err := domain.OriginKindString(entry.Kind)
		if err != nil {
			return nil, err
		}
		origins = append(origins, domain.AllowedOrigin{Pattern: entry.Pattern, Kind: kind})
	}
	return origins, nil
}
