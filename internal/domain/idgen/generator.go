// Package idgen provides ID generation for domain resources.
// IDs are prefixed, opaque, and time-sortable (e.g. "att_01J0Z9KX7Y0Q2Y7JX5M9K2YF3C").
// The project_id is explicitly excluded from this package — it uses a dictionary slug strategy.
package idgen

//go:generate go run go.uber.org/mock/mockgen@latest -typed -package idgenmock -destination ./idgenmock/idgen.mock.go github.com/zitadel/nextgen/internal/domain/idgen Generator

// Generator generates unique, prefixed resource IDs.
// Implementations must be safe for concurrent use.
type Generator interface {
	// New returns a new unique ID for the given prefix (e.g. "att", "user").
	// The prefix must not include the trailing underscore separator.
	// Returns an error if the ID could not be generated.
	New(prefix string) (string, error)
}
