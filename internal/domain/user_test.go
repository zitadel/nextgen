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

func TestNewCreateUser_HonorsCallerSuppliedID(t *testing.T) {
	user := map[string]any{
		"$schema":   "https://example.test/schema.json",
		"email":     "alice@example.com",
		"givenName": "Alice",
	}

	got, err := domain.NewCreateUser("proj_1", nil, "user_provisional", []byte(minimalUserSchema), user)
	require.NoError(t, err)
	assert.Equal(t, "user_provisional", got.ID, "caller-supplied id must pass through unchanged")
}

func TestNewCreateUser_MintsIDWhenCallerLeavesItEmpty(t *testing.T) {
	user := map[string]any{
		"$schema": "https://example.test/schema.json",
		"email":   "alice@example.com",
	}

	got, err := domain.NewCreateUser("proj_1", nil, "", []byte(minimalUserSchema), user)
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(got.ID, string(domain.PrefixUser)+"_"), "minted id must carry the user prefix, got %q", got.ID)
	assert.Greater(t, len(got.ID), len(string(domain.PrefixUser))+1, "minted id must not be just the prefix")
}
