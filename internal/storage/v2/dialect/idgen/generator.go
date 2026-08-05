// Package idgen provides managed resource ID generation for v2 dialects.
// IDs are prefixed opaque strings (e.g. "user_<ulid>" or "user_<uuid>").
// Ownership and dialect strategies are recorded in ADR 047.
package idgen

//go:generate go tool mockgen -typed -package idgenmock -destination ./idgenmock/idgen.mock.go github.com/zitadel/nextgen/internal/storage/v2/dialect/idgen Generator

// Generator generates unique, prefixed resource IDs.
// Implementations must be safe for concurrent use.
type Generator interface {
	// New returns a new unique ID for the given prefix (e.g. "user", "team").
	// The prefix must not include the trailing underscore separator.
	New(prefix string) (string, error)
}
