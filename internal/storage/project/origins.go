package project

import (
	"encoding/json"

	"github.com/zitadel/nextgen/internal/domain"
)

// MarshalOrigins encodes a project's origins for JSON columns.
func MarshalOrigins(origins []domain.Origin) ([]byte, error) {
	if origins == nil {
		origins = []domain.Origin{}
	}
	return json.Marshal(origins)
}

// UnmarshalOrigins decodes a project's origins from a JSON column.
// Legacy string arrays (pre-origins contract) are treated as preview patterns.
func UnmarshalOrigins(raw []byte) ([]domain.Origin, error) {
	if len(raw) == 0 {
		return []domain.Origin{}, nil
	}
	var origins []domain.Origin
	if err := json.Unmarshal(raw, &origins); err == nil {
		return domain.NormalizeOrigins(origins), nil
	}
	var legacy []string
	if err := json.Unmarshal(raw, &legacy); err != nil {
		return nil, err
	}
	out := make([]domain.Origin, 0, len(legacy))
	for _, pattern := range legacy {
		out = append(out, domain.Origin{Pattern: pattern, Kind: domain.OriginKindPreview})
	}
	return domain.NormalizeOrigins(out), nil
}
