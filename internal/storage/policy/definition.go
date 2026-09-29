package policy

import (
	"encoding/json"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// Definition is the structure stored inside the definition JSON column: the
// instance body minus the columns the row already carries.
type Definition struct {
	Config map[string]any `json:"config"`
}

// Marshal converts the revision body into JSON for the definition column.
func Marshal(p *domain.Policy) ([]byte, error) {
	cfg := p.Config
	if cfg == nil {
		cfg = map[string]any{}
	}
	return json.Marshal(Definition{Config: cfg})
}

// ToDomain converts scanned row columns plus the definition JSON into a
// domain.Policy.
func ToDomain(projectID, id, operation string, createdAt time.Time, definition []byte) (*domain.Policy, error) {
	var def Definition
	if len(definition) > 0 {
		if err := json.Unmarshal(definition, &def); err != nil {
			return nil, err
		}
	}
	if def.Config == nil {
		def.Config = map[string]any{}
	}
	return &domain.Policy{
		ProjectID: projectID,
		ID:        id,
		Operation: operation,
		Config:    def.Config,
		// Spanner returns UTC while pgx defaults to local; normalize to UTC.
		CreatedAt: createdAt.UTC(),
	}, nil
}
