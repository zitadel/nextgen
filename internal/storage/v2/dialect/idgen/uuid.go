package idgen

import (
	"github.com/google/uuid"
)

// UUID produces prefixed IDs with random UUID v4 bodies (Spanner write spread).
type UUID struct{}

// NewUUID returns a [UUID] generator.
func NewUUID() *UUID {
	return &UUID{}
}

// New implements [Generator].
func (g *UUID) New(prefix string) (string, error) {
	prefix, err := normalizePrefix(prefix)
	if err != nil {
		return "", err
	}
	id, err := uuid.NewRandom()
	if err != nil {
		return "", err
	}
	return prefix + "_" + id.String(), nil
}
