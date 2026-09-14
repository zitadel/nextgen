package domain_test

import (
	"testing"
	"time"

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

func TestMergeAttributesPatch(t *testing.T) {
	current := map[string]any{
		"email": "alice@example.com",
		"address": map[string]any{
			"city": "Zurich",
			"zip":  "8000",
		},
	}

	t.Run("objects merge recursively, scalars replace", func(t *testing.T) {
		got := domain.MergeAttributesPatch(current, map[string]any{
			"email":   "bob@example.com",
			"address": map[string]any{"city": "Bern"},
		})
		assert.Equal(t, map[string]any{
			"email":   "bob@example.com",
			"address": map[string]any{"city": "Bern", "zip": "8000"},
		}, got)
	})

	t.Run("null deletes, at any depth", func(t *testing.T) {
		got := domain.MergeAttributesPatch(current, map[string]any{
			"email":   nil,
			"address": map[string]any{"zip": nil},
		})
		assert.Equal(t, map[string]any{
			"address": map[string]any{"city": "Zurich"},
		}, got)
	})

	t.Run("an object replaces a scalar and vice versa", func(t *testing.T) {
		got := domain.MergeAttributesPatch(current, map[string]any{
			"email":   map[string]any{"home": "a@example.com"},
			"address": "Bahnhofstrasse 1",
		})
		assert.Equal(t, map[string]any{
			"email":   map[string]any{"home": "a@example.com"},
			"address": "Bahnhofstrasse 1",
		}, got)
	})

	t.Run("nulls inside a fresh object are dropped", func(t *testing.T) {
		got := domain.MergeAttributesPatch(map[string]any{}, map[string]any{
			"contact": map[string]any{"phone": nil, "mail": "a@example.com"},
		})
		assert.Equal(t, map[string]any{
			"contact": map[string]any{"mail": "a@example.com"},
		}, got)
	})

	t.Run("inputs are not mutated", func(t *testing.T) {
		patch := map[string]any{"email": nil, "address": map[string]any{"city": "Bern"}}
		_ = domain.MergeAttributesPatch(current, patch)
		assert.Equal(t, "alice@example.com", current["email"])
		assert.Equal(t, "Zurich", current["address"].(map[string]any)["city"])
		assert.Nil(t, patch["email"])
	})
}

func patchTestCurrentUser() *domain.User {
	return &domain.User{
		ProjectID: "proj_1",
		SchemaURL: "https://example.test/schema.json",
		ID:        "user_1",
		Metadata: domain.UserMetadata{
			UpdatedAt: time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC),
		},
		Attributes: domain.Attributes{
			{Key: "email", Value: "alice@example.com"},
			{Key: "givenName", Value: "Alice"},
		},
	}
}

func TestNewPatchUser(t *testing.T) {
	t.Run("merge keeps untouched keys and carries the guard state", func(t *testing.T) {
		current := patchTestCurrentUser()
		got, err := domain.NewPatchUser(domain.PatchUserParams{
			Current:         current,
			SchemaURL:       current.SchemaURL,
			Schema:          []byte(minimalUserSchema),
			AttributesPatch: map[string]any{"givenName": "Alicia"},
		})
		require.NoError(t, err)

		assert.Equal(t, "proj_1", got.ProjectID)
		assert.Equal(t, "user_1", got.UserID)
		assert.Equal(t, current.SchemaURL, got.SchemaURL)
		assert.Equal(t, current.Metadata.UpdatedAt, got.ExpectedUpdatedAt)

		name, ok := got.Attributes.Get("givenName")
		require.True(t, ok)
		assert.Equal(t, "Alicia", name.Value)
		email, ok := got.Attributes.Get("email")
		require.True(t, ok)
		assert.Equal(t, "alice@example.com", email.Value)
	})

	t.Run("unique annotations are recomputed on the merged state", func(t *testing.T) {
		got, err := domain.NewPatchUser(domain.PatchUserParams{
			Current:         patchTestCurrentUser(),
			SchemaURL:       "https://example.test/schema.json",
			Schema:          []byte(minimalUserSchema),
			AttributesPatch: map[string]any{"email": "bob@example.com"},
		})
		require.NoError(t, err)

		email, ok := got.Attributes.Get("email")
		require.True(t, ok)
		assert.Equal(t, domain.AttributeUniquenessProject, email.UniqueScope)
		assert.NotEqual(t, [32]byte{}, email.ValueHash)
	})

	t.Run("null deletes an optional attribute", func(t *testing.T) {
		got, err := domain.NewPatchUser(domain.PatchUserParams{
			Current:         patchTestCurrentUser(),
			SchemaURL:       "https://example.test/schema.json",
			Schema:          []byte(minimalUserSchema),
			AttributesPatch: map[string]any{"givenName": nil},
		})
		require.NoError(t, err)

		_, ok := got.Attributes.Get("givenName")
		assert.False(t, ok)
		_, ok = got.Attributes.Get("email")
		assert.True(t, ok)
	})

	t.Run("deleting a required attribute fails validation", func(t *testing.T) {
		_, err := domain.NewPatchUser(domain.PatchUserParams{
			Current:         patchTestCurrentUser(),
			SchemaURL:       "https://example.test/schema.json",
			Schema:          []byte(minimalUserSchema),
			AttributesPatch: map[string]any{"email": nil},
		})
		require.ErrorIs(t, err, domain.ErrUserInvalid())
	})

	t.Run("the merged document is what validates, not the patch", func(t *testing.T) {
		_, err := domain.NewPatchUser(domain.PatchUserParams{
			Current:         patchTestCurrentUser(),
			SchemaURL:       "https://example.test/schema.json",
			Schema:          []byte(minimalUserSchema),
			AttributesPatch: map[string]any{"email": 5},
		})
		require.ErrorIs(t, err, domain.ErrUserInvalid())
	})

	// Mirrors the create-side guard: a user is stored as its attribute rows,
	// so a patch must not delete the last one even when the schema allows {}.
	t.Run("deleting every attribute is refused", func(t *testing.T) {
		const allOptionalSchema = `{
			"$schema": "https://json-schema.org/draft/2020-12/schema",
			"$id": "https://example.test/schema.json",
			"type": "object",
			"properties": {"email": {"type": "string"}}
		}`
		current := patchTestCurrentUser()
		current.Attributes = domain.Attributes{{Key: "email", Value: "alice@example.com"}}

		_, err := domain.NewPatchUser(domain.PatchUserParams{
			Current:         current,
			SchemaURL:       "https://example.test/schema.json",
			Schema:          []byte(allOptionalSchema),
			AttributesPatch: map[string]any{"email": nil},
		})
		require.ErrorIs(t, err, domain.ErrUserInvalid())
	})

	// The ADR 009 §4 upgrade: the pointer moves and the merged state must be
	// self-contained under the new schema.
	t.Run("a schema move validates against the new schema", func(t *testing.T) {
		const schemaV2 = `{
			"$schema": "https://json-schema.org/draft/2020-12/schema",
			"$id": "https://example.test/schema-v2.json",
			"type": "object",
			"required": ["email", "department"],
			"properties": {
				"email": {"type": "string"},
				"givenName": {"type": "string"},
				"department": {"type": "string"}
			}
		}`

		_, err := domain.NewPatchUser(domain.PatchUserParams{
			Current:         patchTestCurrentUser(),
			SchemaURL:       "https://example.test/schema-v2.json",
			Schema:          []byte(schemaV2),
			AttributesPatch: map[string]any{},
		})
		require.ErrorIs(t, err, domain.ErrUserInvalid(), "v2 requires department, the patch did not bring it")

		got, err := domain.NewPatchUser(domain.PatchUserParams{
			Current:         patchTestCurrentUser(),
			SchemaURL:       "https://example.test/schema-v2.json",
			Schema:          []byte(schemaV2),
			AttributesPatch: map[string]any{"department": "engineering"},
		})
		require.NoError(t, err)
		assert.Equal(t, "https://example.test/schema-v2.json", got.SchemaURL)
	})

	t.Run("team scope follows the lifecycle owner", func(t *testing.T) {
		current := patchTestCurrentUser()
		current.LifecycleOwnerTeamID = new("team_1")

		got, err := domain.NewPatchUser(domain.PatchUserParams{
			Current:         current,
			SchemaURL:       current.SchemaURL,
			Schema:          []byte(minimalUserSchema),
			AttributesPatch: map[string]any{"givenName": "Alicia"},
		})
		require.NoError(t, err)
		assert.Equal(t, "team_1", got.AttributeTeamScope)

		selfOwned := patchTestCurrentUser()
		got, err = domain.NewPatchUser(domain.PatchUserParams{
			Current:         selfOwned,
			SchemaURL:       selfOwned.SchemaURL,
			Schema:          []byte(minimalUserSchema),
			AttributesPatch: map[string]any{"givenName": "Alicia"},
		})
		require.NoError(t, err)
		assert.Empty(t, got.AttributeTeamScope)
	})
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
