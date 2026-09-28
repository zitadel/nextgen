package users

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func scopesOf(t *testing.T, attrs domain.CreateAttributes) map[domain.AttributeKey]domain.AttributeUniqueness {
	t.Helper()
	scopes := map[domain.AttributeKey]domain.AttributeUniqueness{}
	for _, attr := range attrs {
		scopes[attr.Key] = attr.UniqueScope
	}
	return scopes
}

func TestBuildCreateAttributes_uniquenessFollowsSchema(t *testing.T) {
	schema := map[string]any{
		"properties": map[string]any{
			"email":    map[string]any{"type": "string", "x-unique": "project"},
			"employee": map[string]any{"type": "string", "x-unique": "team"},
			"nickname": map[string]any{"type": "string"},
		},
	}
	attrs := map[domain.AttributeKey]json.RawMessage{
		"username":             json.RawMessage(`"admin@example.com"`),
		"email":                json.RawMessage(`"admin@example.com"`),
		"employee":             json.RawMessage(`"e-1"`),
		"nickname":             json.RawMessage(`"admin"`),
		"zitadel.source":       json.RawMessage(`"cli"`),
		"zitadel.default_user": json.RawMessage(`true`),
	}

	got, err := buildCreateAttributes(attrs, schema, "team_1")
	require.NoError(t, err)

	require.Equal(t, map[domain.AttributeKey]domain.AttributeUniqueness{
		// Always project-unique for bootstrap users, schema or not.
		"username": domain.AttributeUniquenessProject,
		// From the schema's x-unique annotations.
		"email":    domain.AttributeUniquenessProject,
		"employee": domain.AttributeUniquenessTeam,
		// Unannotated properties and the bootstrap markers stay out of the
		// unique registry.
		"nickname":             domain.AttributeUniquenessUnspecified,
		"zitadel.source":       domain.AttributeUniquenessUnspecified,
		"zitadel.default_user": domain.AttributeUniquenessUnspecified,
	}, scopesOf(t, got))
}

// Attribute keys are flattened dotted paths, and the schema nests each node
// behind its own `properties` object — the shape domain.CreateAttributesFromMap
// walks for API-created users.
func TestBuildCreateAttributes_uniquenessFollowsNestedSchema(t *testing.T) {
	schema := map[string]any{
		"properties": map[string]any{
			"contact": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"email": map[string]any{"type": "string", "x-unique": "project"},
					"phone": map[string]any{"type": "string"},
				},
			},
		},
	}
	attrs := map[domain.AttributeKey]json.RawMessage{
		"contact.email": json.RawMessage(`"admin@example.com"`),
		"contact.phone": json.RawMessage(`"+100"`),
	}

	got, err := buildCreateAttributes(attrs, schema, "")
	require.NoError(t, err)

	require.Equal(t, map[domain.AttributeKey]domain.AttributeUniqueness{
		"contact.email": domain.AttributeUniquenessProject,
		"contact.phone": domain.AttributeUniquenessUnspecified,
	}, scopesOf(t, got))
}

// Without a team the row would be stored under the empty team, which the users
// table reads as project-wide — a scope the schema never asked for.
func TestBuildCreateAttributes_teamScopeNeedsATeam(t *testing.T) {
	schema := map[string]any{
		"properties": map[string]any{
			"employee": map[string]any{"type": "string", "x-unique": "team"},
		},
	}
	attrs := map[domain.AttributeKey]json.RawMessage{"employee": json.RawMessage(`"e-1"`)}

	got, err := buildCreateAttributes(attrs, schema, "")
	require.NoError(t, err)

	require.Equal(t, domain.AttributeUniquenessUnspecified, scopesOf(t, got)["employee"])
}

func TestBuildCreateAttributes_placeholderSchemaDeclaresNothingUnique(t *testing.T) {
	attrs := map[domain.AttributeKey]json.RawMessage{
		"username": json.RawMessage(`"admin"`),
		"email":    json.RawMessage(`"admin@example.com"`),
	}

	got, err := buildCreateAttributes(attrs, map[string]any{}, "team_1")
	require.NoError(t, err)

	require.Equal(t, map[domain.AttributeKey]domain.AttributeUniqueness{
		"username": domain.AttributeUniquenessProject,
		"email":    domain.AttributeUniquenessUnspecified,
	}, scopesOf(t, got))
}
