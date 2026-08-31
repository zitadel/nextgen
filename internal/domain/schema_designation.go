package domain

import (
	"errors"
	"fmt"
	"strings"

	"github.com/zitadel/nextgen/internal/maputil"
)

// ErrSchemaDesignationInvalid reports an x-identifier / x-display designation
// the user meta-schema cannot check itself (ADR 058 §1–§2): the named
// property must exist, be a leaf, and — for x-identifier — carry
// project-scoped uniqueness; a schema that enables an auth method needing
// identifier-first dispatch must designate an identifier.
var ErrSchemaDesignationInvalid = errors.New("schema designation invalid")

// validateUserSchemaDesignations enforces the designation rules on a parsed
// user schema document. It runs after meta-schema validation, so shapes the
// meta-schema already guarantees (keyword types) are not re-reported here.
func validateUserSchemaDesignations(schema map[string]any) error {
	identifier, _ := schema[SchemaAnnotationIdentifier].(string)
	hasIdentifier := identifier != ""

	// Password verification is unreachable without a prior identifier (the
	// flow state machine dispatches identifier before password), so enabling
	// it without a designation is a schema error, not a runtime surprise.
	// Passkey is deliberately NOT in this trigger: discoverable credentials
	// identify the user through the assertion itself, so passkey-only (and
	// API-managed) schemas legitimately designate nothing. A flow that picks
	// the identifier-first passkey pattern instead is checked at the flow
	// level, where the on_success manifest requires the identifier upstream.
	// magic_link, otp and sso are enable-able in the meta-schema but not in
	// this trigger yet: they are not wired in the flow engine, and ADR 058
	// defers them ("magic link and OTP join password there when they
	// arrive") — extend the trigger when those methods land.
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
// flattened attribute rows are keyed by) to its property schema. Every
// intermediate segment must be object-shaped — JSON Schema ignores a
// `properties` map on a scalar-typed parent, so a path through one could
// never exist on any valid user document — and the final segment must
// locally declare a scalar type.
func designatedLeaf(schema map[string]any, path, keyword string) (map[string]any, error) {
	unknown := fmt.Errorf("%w: %q names unknown property %q", ErrSchemaDesignationInvalid, keyword, path)
	current := schema
	segments := strings.Split(path, ".")
	for i, segment := range segments {
		properties, ok := current["properties"].(map[string]any)
		if !ok {
			return nil, unknown
		}
		current, ok = properties[segment].(map[string]any)
		if !ok {
			return nil, unknown
		}
		if i < len(segments)-1 && !isObjectShaped(current) {
			return nil, fmt.Errorf("%w: %q path %q: intermediate segment %q must be an object property", ErrSchemaDesignationInvalid, keyword, path, segment)
		}
	}
	if !declaresScalarType(current) {
		return nil, fmt.Errorf("%w: %q property %q must locally declare exactly one scalar type", ErrSchemaDesignationInvalid, keyword, path)
	}
	return current, nil
}

// isObjectShaped reports whether a property schema can hold object values:
// no `type` declared (its `properties` map carries the intent), the type
// "object", or a union whose only non-null entry is "object".
func isObjectShaped(prop map[string]any) bool {
	switch t := prop["type"].(type) {
	case nil:
		return true
	case string:
		return t == "object"
	case []any:
		object := false
		for _, entry := range t {
			switch entry {
			case "object":
				object = true
			case "null":
			default:
				return false
			}
		}
		return object
	}
	return false
}

// declaresScalarType reports whether a property schema locally proves its
// values are non-null scalars via the `type` keyword: one scalar type name,
// optionally in a union with "null" (the nullable idiom). Exactly one
// non-null type is required, matching the flow resolver's reduction —
// schemaReader.JSONType rejects multi-type unions, so accepting one here
// would designate an identifier no flow could ever render as a field. JSON
// Schema keywords are conjunctive, so a local scalar type cannot be widened
// by `$ref`, `allOf`, or any other keyword the property carries; without
// the local proof the shape is indeterminate — an untyped property (or one
// hiding an object behind `$ref`) accepts object values, which flatten into
// child attribute rows with no unique row for the designated path.
func declaresScalarType(prop map[string]any) bool {
	scalar := func(entry any) bool {
		switch entry {
		case "string", "number", "integer", "boolean":
			return true
		}
		return false
	}
	switch t := prop["type"].(type) {
	case string:
		return scalar(t)
	case []any:
		nonNull := 0
		for _, entry := range t {
			if entry == "null" {
				continue
			}
			if !scalar(entry) {
				return false
			}
			nonNull++
		}
		return nonNull == 1
	}
	return false
}
