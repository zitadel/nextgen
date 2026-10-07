package project

import (
	"encoding/json"

	"github.com/zitadel/nextgen/internal/domain"
)

// entry is the stored shape of one origin. Kind is written
// as its wire string so a row explains itself without the enum that wrote it.
type entry struct {
	Pattern string `json:"pattern"`
	Kind    string `json:"kind"`
}

// MarshalOrigins renders the entries for the origins column. An empty list
// is stored as `[]`, never NULL: the column is NOT NULL and no patterns is
// an answer (allow everything on a sandbox).
func MarshalOrigins(origins []domain.Origin) ([]byte, error) {
	encoded := make([]entry, 0, len(origins))
	for _, origin := range origins {
		encoded = append(encoded, entry{Pattern: origin.Pattern, Kind: origin.Kind.String()})
	}
	return json.Marshal(encoded)
}

// UnmarshalOrigins reads the column back. Never nil, so a project with
// no patterns carries an empty list.
func UnmarshalOrigins(raw []byte) ([]domain.Origin, error) {
	origins := []domain.Origin{}
	if len(raw) == 0 || string(raw) == "null" {
		return origins, nil
	}
	var stored []entry
	if err := json.Unmarshal(raw, &stored); err != nil {
		return nil, err
	}
	for _, entry := range stored {
		kind, err := domain.OriginKindString(entry.Kind)
		if err != nil {
			return nil, err
		}
		origins = append(origins, domain.Origin{Pattern: entry.Pattern, Kind: kind})
	}
	return origins, nil
}
