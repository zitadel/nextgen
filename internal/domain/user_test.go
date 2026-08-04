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
		user  map[string]any
		check func(t *testing.T, got *domain.CreateUser)
	}{
		{
			name: "caller-supplied id passes through",
			id:   "user_provisional",
			user: map[string]any{
				"$schema":   "https://example.test/schema.json",
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
			user: map[string]any{
				"$schema": "https://example.test/schema.json",
				"email":   "alice@example.com",
			},
			check: func(t *testing.T, got *domain.CreateUser) {
				assert.Empty(t, got.ID)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := domain.NewCreateUser("proj_1", nil, tt.id, []byte(minimalUserSchema), tt.user)
			require.NoError(t, err)
			tt.check(t, got)
		})
	}
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
