package domain_test

import (
	"strings"
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
			name: "empty id mints a fresh one with the user prefix",
			id:   "",
			user: map[string]any{
				"$schema": "https://example.test/schema.json",
				"email":   "alice@example.com",
			},
			check: func(t *testing.T, got *domain.CreateUser) {
				prefix := string(domain.PrefixUser) + "_"
				assert.True(t, strings.HasPrefix(got.ID, prefix), "want prefix %q, got id %q", prefix, got.ID)
				assert.Greater(t, len(got.ID), len(prefix), "minted id must not be just the prefix")
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
