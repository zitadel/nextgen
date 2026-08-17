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
			got, err := domain.NewCreateUser("proj_1", nil, tt.id, "https://example.test/schema.json", []byte(minimalUserSchema), tt.attrs)
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

	got, err := domain.NewCreateUser("proj_1", nil, "user_1", "https://example.test/schema.json", []byte(schema), map[string]any{
		"id":       "employee-42",
		"metadata": "from the HR system",
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

	got, err := domain.NewCreateUser("proj_1", nil, "user_1", "https://example.test/schema.json", []byte(closedSchema), map[string]any{
		"email": "alice@example.com",
	})
	require.NoError(t, err)
	assert.Len(t, got.Attributes, 1)

	_, err = domain.NewCreateUser("proj_1", nil, "user_1", "https://example.test/schema.json", []byte(closedSchema), map[string]any{
		"email":      "alice@example.com",
		"undeclared": "x",
	})
	require.Error(t, err)
}

func TestNewCreateUser_SchemaURLRequired(t *testing.T) {
	_, err := domain.NewCreateUser("proj_1", nil, "user_1", "", []byte(minimalUserSchema), map[string]any{
		"email": "alice@example.com",
	})
	require.Error(t, err)
}

func TestUserDisplayName(t *testing.T) {
	tests := []struct {
		name  string
		attrs []domain.Attribute
		want  string
	}{
		{
			// The shipped presets collect camelCase name parts
			// (packages/config/defaults/*.json).
			name: "camelCase preset shape",
			attrs: []domain.Attribute{
				{Key: "givenName", Value: "Ada"},
				{Key: "familyName", Value: "Lovelace"},
			},
			want: "Ada Lovelace",
		},
		{
			name: "snake_case fallback",
			attrs: []domain.Attribute{
				{Key: "given_name", Value: "Ada"},
				{Key: "family_name", Value: "Lovelace"},
			},
			want: "Ada Lovelace",
		},
		{
			name: "camelCase wins over snake_case per part",
			attrs: []domain.Attribute{
				{Key: "givenName", Value: "Ada"},
				{Key: "given_name", Value: "ignored"},
				{Key: "family_name", Value: "Lovelace"},
			},
			want: "Ada Lovelace",
		},
		{
			name: "explicit name takes precedence",
			attrs: []domain.Attribute{
				{Key: "name", Value: "Countess of Lovelace"},
				{Key: "givenName", Value: "Ada"},
			},
			want: "Countess of Lovelace",
		},
		{
			name: "single part stands alone",
			attrs: []domain.Attribute{
				{Key: "familyName", Value: "Lovelace"},
			},
			want: "Lovelace",
		},
		{
			name:  "no identity attributes",
			attrs: []domain.Attribute{{Key: "email", Value: "ada@example.com"}},
			want:  "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			user := &domain.User{Attributes: tt.attrs}
			assert.Equal(t, tt.want, user.DisplayName())
		})
	}
}
