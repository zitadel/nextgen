package domain

import (
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/zitadel/nextgen/internal/maputil"
)

// ErrSchemaDesignationInvalid reports an x-identifier / x-display designation
// the user meta-schema cannot check itself (ADR 057 §1–§2): the named
// property must exist, be a leaf, and — for x-identifier — carry
// project-scoped uniqueness; a schema that enables an auth method needing
// identifier-first dispatch must designate an identifier.
var ErrSchemaDesignationInvalid = errors.New("schema designation invalid")

// validateUserSchemaDesignations enforces the designation rules on a parsed
// user schema document. It runs after meta-schema validation, so shapes the
// meta-schema already guarantees (keyword types) are not re-reported here.
func validateUserSchemaDesignations(schema map[string]any) error {
	identifier, hasIdentifier := schema[SchemaAnnotationIdentifier].(string)
	hasIdentifier = hasIdentifier && identifier != ""

	// Password verification is unreachable without a prior identifier (the
	// flow state machine dispatches identifier before password), so enabling
	// it without a designation is a schema error, not a runtime surprise.
	// Passkey is deliberately NOT in this trigger: discoverable credentials
	// identify the user through the assertion itself, so passkey-only (and
	// API-managed) schemas legitimately designate nothing. A flow that picks
	// the identifier-first passkey pattern instead is checked at the flow
	// level, where the on_success manifest requires the identifier upstream.
	if enabled, _ := maputil.GetNested[bool](schema, []string{SchemaAnnotationAuthMethods, "password", "enabled"}); enabled && !hasIdentifier {
		return fmt.Errorf("%w: password authentication is enabled but the schema designates no %q", ErrSchemaDesignationInvalid, SchemaAnnotationIdentifier)
	}

	if hasIdentifier {
		prop, err := designatedLeaf(schema, identifier, SchemaAnnotationIdentifier)
		if err != nil {
			return err
		}
		if scope, _ := prop[SchemaAnnotationUnique].(string); scope != SchemaUniqueScopeProject {
			return fmt.Errorf("%w: %q property %q must carry %s %q, has %q", ErrSchemaDesignationInvalid, SchemaAnnotationIdentifier, identifier, SchemaAnnotationUnique, SchemaUniqueScopeProject, scope)
		}
	}

	if display, ok := schema[SchemaAnnotationDisplay].([]any); ok {
		for _, entry := range display {
			path, ok := entry.(string)
			if !ok || path == "" {
				return fmt.Errorf("%w: %q entries must be non-empty property paths", ErrSchemaDesignationInvalid, SchemaAnnotationDisplay)
			}
			if _, err := designatedLeaf(schema, path, SchemaAnnotationDisplay); err != nil {
				return err
			}
		}
	}
	return nil
}

// designatedLeaf resolves a dot-separated attribute path (the same path shape
// flattened attribute rows are keyed by) to its property schema and requires
// it to be a leaf: a scalar value, not an object or array.
func designatedLeaf(schema map[string]any, path, keyword string) (map[string]any, error) {
	current := schema
	for _, segment := range strings.Split(path, ".") {
		properties, ok := current["properties"].(map[string]any)
		if !ok {
			return nil, fmt.Errorf("%w: %q names unknown property %q", ErrSchemaDesignationInvalid, keyword, path)
		}
		current, ok = properties[segment].(map[string]any)
		if !ok {
			return nil, fmt.Errorf("%w: %q names unknown property %q", ErrSchemaDesignationInvalid, keyword, path)
		}
	}
	if !declaresScalarType(current) {
		return nil, fmt.Errorf("%w: %q property %q must locally declare a scalar type", ErrSchemaDesignationInvalid, keyword, path)
	}
	return current, nil
}

// declaresScalarType reports whether a property schema locally proves its
// values are scalars via the `type` keyword — a single scalar type name, or
// a union of them (the nullable idiom included). JSON Schema keywords are
// conjunctive, so a local scalar `type` cannot be widened by `$ref`,
// `allOf`, or any other keyword the property carries. Without that local
// proof the shape is indeterminate — an untyped property (or one hiding an
// object behind `$ref`) accepts object values, which flatten into child
// attribute rows with no unique row for the designated path.
func declaresScalarType(prop map[string]any) bool {
	isScalar := func(entry any) bool {
		switch entry {
		case "string", "number", "integer", "boolean", "null":
			return true
		}
		return false
	}
	switch t := prop["type"].(type) {
	case string:
		return isScalar(t)
	case []any:
		return len(t) > 0 && !slices.ContainsFunc(t, func(entry any) bool { return !isScalar(entry) })
	}
	return false
}
