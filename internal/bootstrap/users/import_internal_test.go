package users

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
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

// schemaRows is the ids a project stores. A minted sch_ id is a deployed
// human-user schema.
type schemaRows map[string]bool

// statements is a statements mock that answers schema reads from rows.
func (r schemaRows) statements(t *testing.T) *servicemocks.MockAllStatements {
	stmts := servicemocks.NewMockAllStatements(gomock.NewController(t))
	stmts.EXPECT().GetJSONSchemaByID(gomock.Any(), gomock.Any(), gomock.Any()).AnyTimes().
		DoAndReturn(func(_ context.Context, projectID, schemaID string) (*domain.JSONSchema, error) {
			if !r[schemaID] {
				return nil, database.NewNoRowFoundError(nil)
			}
			return &domain.JSONSchema{ProjectID: projectID, URL: schemaID}, nil
		})
	stmts.EXPECT().ListJSONSchemas(gomock.Any(), gomock.Any(), gomock.Any()).AnyTimes().
		DoAndReturn(func(_ context.Context, list *database.ListOptions[domain.JSONSchemaField], _ service.JSONSchemaQueryOptions) (*database.ListResult[*domain.JSONSchema], error) {
			require.Equal(t, database.And(
				database.Equal(database.Col(domain.JSONSchemaFieldProjectID), "proj_1"),
				database.Equal(database.Col(domain.JSONSchemaFieldObjectType), "human-user"),
			), list.Filter)
			result := &database.ListResult[*domain.JSONSchema]{}
			for id := range r {
				if strings.HasPrefix(id, "sch_") {
					result.Items = append(result.Items, &domain.JSONSchema{URL: id})
				}
			}
			return result, nil
		})
	return stmts
}

func TestStoredSchemaURL(t *testing.T) {
	bases := domain.NewBuiltinSchemaBases("https://schemas.test/builtin/v1", "https://nextgen.com/api/schemas")
	current := "https://schemas.test/builtin/v1/default-human-user.json"
	legacy := "https://nextgen.com/api/schemas/default-human-user.json"

	tests := []struct {
		name   string
		stored schemaRows
		header string
		want   string
	}{
		{"legacy document meets a project seeded under the current base", schemaRows{current: true}, legacy, current},
		{"current document meets a project seeded under the legacy base", schemaRows{legacy: true}, current, legacy},
		{"the exact row wins over its twin", schemaRows{current: true, legacy: true}, legacy, legacy},
		{"a missing schema keeps the document's URL", schemaRows{}, legacy, legacy},
		{"the default schema of a project that deployed it is the deployed one", schemaRows{"sch_1": true}, current, "sch_1"},
		{"a schema outside the namespace is looked up as written", schemaRows{current: true}, "https://schemas.test/custom.json", "https://schemas.test/custom.json"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := storedSchemaURL(t.Context(), tt.stored.statements(t), bases, Header{ProjectID: "proj_1", SchemaURL: tt.header})
			require.NoError(t, err)
			require.Equal(t, tt.want, got)
		})
	}
}
