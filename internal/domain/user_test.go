package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
)

const minimalUserSchema = `{
	"$schema": "https://json-schema.org/draft/2020-12/schema",
	"$id": "https://example.test/schema.json",
	"type": "object",
	"required": ["email"],
	"properties": {
		"email": {"type": "string", "format": "email", "x-unique": "project"},
		"givenName": {"type": "string"}
	}
}`

func TestNewCreateUser(t *testing.T) {
	tests := []struct {
		name  string
		id    string
		attrs map[string]any
		check func(t *testing.T, got *domain.CreateUser)
	}{
		{
			name: "caller-supplied id passes through",
			id:   "user_provisional",
			attrs: map[string]any{
				"email":     "alice@example.com",
				"givenName": "Alice",
			},
			check: func(t *testing.T, got *domain.CreateUser) {
				assert.Equal(t, "user_provisional", got.ID)
			},
		},
		{
			name: "empty id leaves assignment to the dialect on create",
			id:   "",
			attrs: map[string]any{
				"email": "alice@example.com",
			},
			check: func(t *testing.T, got *domain.CreateUser) {
				assert.Empty(t, got.ID)
			},
		},
		{
			name: "schema url is not stored as an attribute",
			id:   "user_1",
			attrs: map[string]any{
				"email": "alice@example.com",
			},
			check: func(t *testing.T, got *domain.CreateUser) {
				assert.Equal(t, "https://example.test/schema.json", got.SchemaURL)
				for _, attr := range got.Attributes {
					assert.NotEqual(t, domain.AttributeKey("$schema"), attr.Key)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := domain.NewCreateUser(domain.CreateUserParams{
				ProjectID:  "proj_1",
				ID:         tt.id,
				SchemaURL:  "https://example.test/schema.json",
				Schema:     []byte(minimalUserSchema),
				Attributes: tt.attrs,
			})
			require.NoError(t, err)
			tt.check(t, got)
		})
	}
}

// A schema is free to name a property `id` or `metadata`: those names belong to
// the response envelope, which is not part of the validated document.
func TestNewCreateUser_EnvelopeNamesAreUsable(t *testing.T) {
	const schema = `{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"$id": "https://example.test/schema.json",
		"type": "object",
		"properties": {
			"id": {"type": "string"},
			"metadata": {"type": "string"}
		}
	}`

	got, err := domain.NewCreateUser(domain.CreateUserParams{
		ProjectID: "proj_1",
		ID:        "user_1",
		SchemaURL: "https://example.test/schema.json",
		Schema:    []byte(schema),
		Attributes: map[string]any{
			"id":       "employee-42",
			"metadata": "from the HR system",
		},
	})
	require.NoError(t, err)

	values := map[domain.AttributeKey]any{}
	for _, attr := range got.Attributes {
		values[attr.Key] = attr.Value
	}
	assert.Equal(t, "employee-42", values["id"])
	assert.Equal(t, "from the HR system", values["metadata"])
	assert.Equal(t, "user_1", got.ID)
}

// The validated document is the attributes object alone, so a schema may close
// itself off without the envelope tripping the check.
func TestNewCreateUser_ClosedSchema(t *testing.T) {
	const closedSchema = `{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"$id": "https://example.test/schema.json",
		"type": "object",
		"additionalProperties": false,
		"required": ["email"],
		"properties": {
			"email": {"type": "string"}
		}
	}`

	got, err := domain.NewCreateUser(domain.CreateUserParams{
		ProjectID: "proj_1",
		ID:        "user_1",
		SchemaURL: "https://example.test/schema.json",
		Schema:    []byte(closedSchema),
		Attributes: map[string]any{
			"email": "alice@example.com",
		},
	})
	require.NoError(t, err)
	assert.Len(t, got.Attributes, 1)

	_, err = domain.NewCreateUser(domain.CreateUserParams{
		ProjectID: "proj_1",
		ID:        "user_1",
		SchemaURL: "https://example.test/schema.json",
		Schema:    []byte(closedSchema),
		Attributes: map[string]any{
			"email":      "alice@example.com",
			"undeclared": "x",
		},
	})
	require.Error(t, err)
}

func TestNewCreateUser_SchemaURLRequired(t *testing.T) {
	_, err := domain.NewCreateUser(domain.CreateUserParams{
		ProjectID: "proj_1",
		ID:        "user_1",
		Schema:    []byte(minimalUserSchema),
		Attributes: map[string]any{
			"email": "alice@example.com",
		},
	})
	require.Error(t, err)
}

// A user is stored as its attribute rows, so an empty document is refused at
// the domain rather than reaching the dialects' identical guard, which would
// answer 500. All-optional schemas make it a document the schema accepts.
func TestNewCreateUser_AttributesRequired(t *testing.T) {
	const allOptionalSchema = `{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"$id": "https://example.test/schema.json",
		"type": "object",
		"properties": {
			"email": {"type": "string"}
		}
	}`

	_, err := domain.NewCreateUser(domain.CreateUserParams{
		ProjectID:  "proj_1",
		ID:         "user_1",
		SchemaURL:  "https://example.test/schema.json",
		Schema:     []byte(allOptionalSchema),
		Attributes: map[string]any{},
	})
	require.ErrorIs(t, err, domain.ErrUserInvalid())
}
