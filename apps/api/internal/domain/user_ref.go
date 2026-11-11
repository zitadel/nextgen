package domain

import (
	"strconv"
	"strings"
)

// UserRef is the resolved reference to a user carried by user-linked
// resources (ADR 058 §3). Fields are role-named, not property-named, so
// responses can mix users from different schemas. An empty field means
// absent on the wire; Identifier and Display resolve independently of each
// other, and clients render Display → Identifier → UserID.
type UserRef struct {
	UserID string
	// Identifier is the current value of the schema's designated identifier
	// (x-identifier). Empty when the schema designates nothing or the user
	// lacks the value.
	Identifier string
	// IdentifierProperty names the schema property Identifier came from, so
	// clients can reach the property's schema for semantics instead of
	// guessing from the value. Set exactly when Identifier is.
	IdentifierProperty string
	// Display is the x-display rendering: the designated properties' values
	// joined in list order. Purely presentational — no source attribution.
	Display string
}

// ResolveUserRef derives the user's reference from their schema document's
// designations. Attribute values are read from the user's loaded attributes:
// designation paths are dot-joined leaf paths, matching the EAV flattening
// of [AttributeKey], so entries address attribute keys verbatim. The user's
// attributes must be hydrated with at least the designated keys (see
// [DesignatedAttributeKeys]).
func ResolveUserRef(user *User, schemaDocument []byte) UserRef {
	ref := UserRef{UserID: user.ID}
	if property := DesignatedIdentifier(schemaDocument); property != "" {
		if value := scalarAttributeString(user, property); value != "" {
			ref.Identifier = value
			ref.IdentifierProperty = property
		}
	}
	parts := make([]string, 0, 2)
	for _, path := range DesignatedDisplay(schemaDocument) {
		if value := scalarAttributeString(user, path); value != "" {
			parts = append(parts, value)
		}
	}
	ref.Display = strings.Join(parts, " ")
	return ref
}

// scalarAttributeString renders the attribute at the designated path for the
// wire. Designated properties declare exactly one non-null scalar type
// ([declaresScalarType]), so string, number, and boolean are the shapes a
// valid document can put here; anything else reads as absent.
func scalarAttributeString(user *User, path string) string {
	value, ok := user.Attributes.Get(AttributeKey(path))
	if !ok {
		return ""
	}
	switch v := value.(type) {
	case string:
		return v
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(v)
	}
	return ""
}

// DesignatedAttributeKeys returns the attribute keys a schema document's
// designations read — the hydration set a batch ref resolution needs
// (ADR 058 §3a: rows hydrate only the designated attribute keys).
func DesignatedAttributeKeys(schemaDocument []byte) []string {
	var keys []string
	if property := DesignatedIdentifier(schemaDocument); property != "" {
		keys = append(keys, property)
	}
	return append(keys, DesignatedDisplay(schemaDocument)...)
}
