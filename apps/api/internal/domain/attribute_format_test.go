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

func TestNewPatchUser_AssertsOnlyWhatItChanges(t *testing.T) {
	const url = "https://example.test/schema.json"
	stored := func() *domain.User {
		user := patchTestCurrentUser()
		user.Attributes = domain.Attributes{
			{Key: "email", Value: "not-an-email"},
			{Key: "givenName", Value: "Alice"},
			{Key: "contact.email", Value: "stored-nope"},
		}
		return user
	}
	patch := func(user *domain.User, schemaURL string, attrs map[string]any) error {
		_, err := domain.NewPatchUser(domain.PatchUserParams{
			Current:         user,
			SchemaURL:       schemaURL,
			Schema:          []byte(formatUserSchema),
			AttributesPatch: attrs,
		})
		return err
	}
	keys := func(t *testing.T, err error) []domain.AttributeKey {
		t.Helper()
		require.ErrorIs(t, err, domain.ErrUserAttributesInvalid(nil))
		var derr domain.Error
		require.ErrorAs(t, err, &derr)
		return derr.Details.(domain.UserAttributesDetails).Keys
	}

	t.Run("a stored failure does not block an unrelated attribute", func(t *testing.T) {
		require.NoError(t, patch(stored(), url, map[string]any{"givenName": "Alicia"}))
	})
	t.Run("nor a fix of one of two", func(t *testing.T) {
		require.NoError(t, patch(stored(), url, map[string]any{"email": "alice@example.com"}))
	})
	t.Run("nor sending the stored value again", func(t *testing.T) {
		require.NoError(t, patch(stored(), url, map[string]any{"email": "not-an-email", "givenName": "Alicia"}))
	})
	t.Run("a bad value replacing a bad one is refused", func(t *testing.T) {
		err := patch(stored(), url, map[string]any{"email": "still-not-an-email"})
		assert.Equal(t, []domain.AttributeKey{"email"}, keys(t, err))
	})
	t.Run("a bad value replacing a good one is refused", func(t *testing.T) {
		err := patch(patchTestCurrentUser(), url, map[string]any{"email": "not-an-email"})
		assert.Equal(t, []domain.AttributeKey{"email"}, keys(t, err))
	})
	t.Run("a nested bad value is refused beside a stored one", func(t *testing.T) {
		err := patch(stored(), url, map[string]any{"contact": map[string]any{"email": "new-nope"}})
		assert.Equal(t, []domain.AttributeKey{"contact.email"}, keys(t, err))
	})
	t.Run("a failure format has no part in is still refused", func(t *testing.T) {
		err := patch(stored(), url, map[string]any{"age": "old"})
		assert.Contains(t, keys(t, err), domain.AttributeKey("age"))
	})
	t.Run("a move to another schema asserts every value", func(t *testing.T) {
		err := patch(stored(), "https://example.test/schema-v2.json", map[string]any{"givenName": "Alicia"})
		assert.Equal(t, []domain.AttributeKey{"contact.email", "email"}, keys(t, err))
	})
	t.Run("a move fixing them in the same request passes", func(t *testing.T) {
		require.NoError(t, patch(stored(), "https://example.test/schema-v2.json", map[string]any{
			"email":   "alice@example.com",
			"contact": map[string]any{"email": "alice@example.com"},
		}))
	})
}
