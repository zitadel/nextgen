package idgen

import (
	"fmt"

	"github.com/google/uuid"
)

// UUID is a [Generator] that produces prefixed IDs using random UUID v4 bodies.
// Prefer this on Spanner so writes under (project_id, id) do not cluster on a
// time-sortable trailing key. UUID is safe for concurrent use.
type UUID struct{}

// NewUUID returns a [UUID] generator.
func NewUUID() *UUID {
	return &UUID{}
}

// New implements [Generator]. It returns "<prefix>_<uuid>", for example
// "user_550e8400-e29b-41d4-a716-446655440000".
func (g *UUID) New(prefix string) (string, error) {
	if prefix == "" {
		return "", fmt.Errorf("idgen: prefix must not be empty")
	}
	if prefix[len(prefix)-1] == '_' {
		prefix = prefix[:len(prefix)-1]
	}
	id, err := uuid.NewRandom()
	if err != nil {
		return "", err
	}
	return prefix + "_" + id.String(), nil
}
