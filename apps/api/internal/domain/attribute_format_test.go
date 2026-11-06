package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
)

const formatUserSchema = `{
	"$schema": "https://json-schema.org/draft/2020-12/schema",
	"$id": "https://example.test/schema.json",
	"type": "object",
	"required": ["email"],
	"properties": {
		"email": {"type": "string", "format": "email", "x-unique": "project"},
		"givenName": {"type": "string"},
		"age": {"type": "integer"},
		"seen": {"type": "string", "format": "date-time"},
		"phone": {"type": "string", "format": "phone"},
		"homepage": {"type": ["string", "null"], "format": "uri"},
		"contact": {
			"type": "object",
			"properties": {"email": {"type": "string", "format": "email"}}
		},
		"aliases": {"type": "array", "items": {"type": "string", "format": "email"}}
	}
}`

func createWithFormat(attrs map[string]any) error {
	_, err := domain.NewCreateUser(domain.CreateUserParams{
		ProjectID:  "proj_1",
		ID:         "user_1",
		SchemaURL:  "https://example.test/schema.json",
		Schema:     []byte(formatUserSchema),
		Attributes: attrs,
	})
	return err
}

func TestNewCreateUser_AssertsFormat(t *testing.T) {
	refused := map[string]struct {
		attrs map[string]any
		key   domain.AttributeKey
	}{
		"no at sign":     {map[string]any{"email": "not-an-email"}, "email"},
		"empty":          {map[string]any{"email": ""}, "email"},
		"leading space":  {map[string]any{"email": " alice@example.com"}, "email"},
		"trailing space": {map[string]any{"email": "alice@example.com "}, "email"},
		"angle brackets": {map[string]any{"email": "<alice@example.com>"}, "email"},
		"display name":   {map[string]any{"email": "Alice <alice@example.com>"}, "email"},
		"two addresses":  {map[string]any{"email": "a@example.com, b@example.com"}, "email"},
		"second at sign": {map[string]any{"email": "a@b@example.com"}, "email"},
		"quoted address": {map[string]any{"email": `"a b"@example.com`}, "email"},
		"date-time":      {map[string]any{"email": "a@example.com", "seen": "yesterday"}, "seen"},
		"nullable uri":   {map[string]any{"email": "a@example.com", "homepage": "no scheme"}, "homepage"},
		"nested":         {map[string]any{"email": "a@example.com", "contact": map[string]any{"email": "nope"}}, "contact.email"},
		"array item":     {map[string]any{"email": "a@example.com", "aliases": []any{"nope"}}, "aliases"},
	}
	for name, tc := range refused {
		t.Run("refuses "+name, func(t *testing.T) {
			err := createWithFormat(tc.attrs)
			require.ErrorIs(t, err, domain.ErrUserAttributesInvalid(nil))
			var derr domain.Error
			require.ErrorAs(t, err, &derr)
			assert.Equal(t, domain.UserAttributesDetails{Keys: []domain.AttributeKey{tc.key}}, derr.Details)
		})
	}

	accepted := map[string]map[string]any{
		"plain address":         {"email": "alice@example.com"},
		"plus address":          {"email": "alice+tag@example.com"},
		"no dot in the domain":  {"email": "admin@localhost"},
		"non-ASCII local part":  {"email": "jürg@example.com"},
		"non-ASCII domain":      {"email": "alice@münchen.de"},
		"date-time":             {"email": "a@example.com", "seen": "2026-11-03T12:00:00Z"},
		"format nobody asserts": {"email": "a@example.com", "phone": "call me"},
		"null for a nullable":   {"email": "a@example.com", "homepage": nil},
	}
	for name, attrs := range accepted {
		t.Run("accepts "+name, func(t *testing.T) {
			require.NoError(t, createWithFormat(attrs))
		})
	}
}

func TestAttributeFormatValid_IdnEmailHoldsToTheEmailRules(t *testing.T) {
	for _, refused := range []string{" a@example.com", "a@example.com ", "<a@example.com>", "Al <a@example.com>"} {
		assert.False(t, domain.AttributeFormatValid("idn-email", refused), refused)
	}
	for _, accepted := range []string{"a@example.com", "jürg@example.com", "alice@münchen.de"} {
		assert.True(t, domain.AttributeFormatValid("idn-email", accepted), accepted)
	}
}

func TestNewPatchUser_AssertsFormat(t *testing.T) {
	stored := func() *domain.User {
		user := patchTestCurrentUser()
		user.Attributes = domain.Attributes{
			{Key: "email", Value: "not-an-email"},
			{Key: "givenName", Value: "Alice"},
		}
		return user
	}
	patch := func(attrs map[string]any) error {
		_, err := domain.NewPatchUser(domain.PatchUserParams{
			Current:         stored(),
			SchemaURL:       stored().SchemaURL,
			Schema:          []byte(formatUserSchema),
			AttributesPatch: attrs,
		})
		return err
	}

	t.Run("a stored failure blocks a patch until it is fixed", func(t *testing.T) {
		require.ErrorIs(t, patch(map[string]any{"givenName": "Alicia"}), domain.ErrUserAttributesInvalid(nil))
	})
	t.Run("fixing it in the same request passes", func(t *testing.T) {
		require.NoError(t, patch(map[string]any{"givenName": "Alicia", "email": "alice@example.com"}))
	})
	t.Run("a bad value is refused", func(t *testing.T) {
		require.ErrorIs(t, patch(map[string]any{"email": "still-nope"}), domain.ErrUserAttributesInvalid(nil))
	})
}
