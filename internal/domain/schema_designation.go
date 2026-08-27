package domain

import (
	"errors"
	"fmt"
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
	if kind, _ := current["type"].(string); kind == "object" || kind == "array" {
		return nil, fmt.Errorf("%w: %q property %q must be a leaf, is %s", ErrSchemaDesignationInvalid, keyword, path, kind)
	}
	return current, nil
}
