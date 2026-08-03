// Package idgen provides managed resource ID generation for v2 dialects.
// IDs are prefixed, opaque, and time-sortable (e.g. "user_01J0Z9KX7Y0Q2Y7JX5M9K2YF3C").
// Ownership and dialect strategies are recorded in ADR 047.
package idgen

//go:generate go tool mockgen -typed -package idgenmock -destination ./idgenmock/idgen.mock.go github.com/zitadel/nextgen/internal/storage/v2/dialect/idgen Generator

// Generator generates unique, prefixed resource IDs.
// Implementations must be safe for concurrent use.
type Generator interface {
	// New returns a new unique ID for the given prefix (e.g. "user", "team").
	// The prefix must not include the trailing underscore separator.
	// Returns an error if the ID could not be generated.
	New(prefix string) (string, error)
}
