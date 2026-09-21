package domain_test

import (
	"testing"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestSchemaFieldResolver_PasswordValidationHook(t *testing.T) {
	t.Parallel()
	schema := mustUnmarshal[jsonschema.Schema](t, `{
		"type": "object",
		"x-auth-methods": { "password": { "enabled": true } }
	}`)

	resolver := domain.NewSchemaFieldResolver()
	resolver.PasswordValidation = func() *domain.FlowFieldValidation {
		return &domain.FlowFieldValidation{MinLength: 15}
	}
	resolved, err := resolver.Resolve(schema, "password", []domain.Field{"x-auth-methods#password"})
	require.NoError(t, err)
	require.Len(t, resolved.Fields, 1)
	require.Equal(t, &domain.FlowFieldValidation{MinLength: 15}, resolved.Fields[0].Validation)
}
