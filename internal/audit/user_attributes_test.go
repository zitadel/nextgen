package audit_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/audit"
)

func TestUserAttributeAuditFields(t *testing.T) {
	t.Parallel()

	schema := []byte(`{
		"type":"object",
		"properties":{
			"email":{"type":"string","x-audit":true},
			"display_name":{"type":"string"},
			"phone":{"type":"string","x-audit":"identifier"}
		}
	}`)

	keys, attrs := audit.UserAttributeAuditFields(map[string]any{
		"$schema":      "https://example.test/user.json",
		"email":        "a@example.com",
		"display_name": "Ada",
		"phone":        "+1",
		"id":           "should-skip",
	}, schema)

	assert.Equal(t, []string{"display_name", "email", "phone"}, keys)
	require.Equal(t, map[string]any{
		"email": "a@example.com",
		"phone": "+1",
	}, attrs)
}

func TestUserAttributeAuditFields_NoSchemaStillReturnsKeys(t *testing.T) {
	t.Parallel()
	keys, attrs := audit.UserAttributeAuditFields(map[string]any{
		"email": "a@example.com",
	}, nil)
	assert.Equal(t, []string{"email"}, keys)
	assert.Nil(t, attrs)
}
