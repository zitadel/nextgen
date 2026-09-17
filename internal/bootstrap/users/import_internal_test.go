package users

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestBuildCreateAttributes_uniquenessFollowsSchema(t *testing.T) {
	schema := map[string]any{
		"properties": map[string]any{
			"email":    map[string]any{"type": "string", "x-unique": "project"},
			"employee": map[string]any{"type": "string", "x-unique": "team"},
			"nickname": map[string]any{"type": "string"},
		},
	}
	attrs := map[domain.AttributeKey]json.RawMessage{
		"username": json.RawMessage(`"admin@example.com"`),
		"email":    json.RawMessage(`"admin@example.com"`),
		"employee": json.RawMessage(`"e-1"`),
		"nickname": json.RawMessage(`"admin"`),
	}

	got, err := buildCreateAttributes(attrs, schema)
	require.NoError(t, err)

	scopes := map[domain.AttributeKey]domain.AttributeUniqueness{}
	for _, attr := range got {
		scopes[attr.Key] = attr.UniqueScope
	}
	require.Equal(t, map[domain.AttributeKey]domain.AttributeUniqueness{
		// Always project-unique for bootstrap users, schema or not.
		"username": domain.AttributeUniquenessProject,
		// From the schema's x-unique annotations.
		"email":    domain.AttributeUniquenessProject,
		"employee": domain.AttributeUniquenessTeam,
		"nickname": domain.AttributeUniquenessUnspecified,
	}, scopes)
}

func TestBuildCreateAttributes_placeholderSchemaDeclaresNothingUnique(t *testing.T) {
	attrs := map[domain.AttributeKey]json.RawMessage{
		"username": json.RawMessage(`"admin"`),
		"email":    json.RawMessage(`"admin@example.com"`),
	}

	got, err := buildCreateAttributes(attrs, map[string]any{})
	require.NoError(t, err)

	for _, attr := range got {
		if attr.Key == "username" {
			require.Equal(t, domain.AttributeUniquenessProject, attr.UniqueScope)
			continue
		}
		require.Equal(t, domain.AttributeUniquenessUnspecified, attr.UniqueScope, attr.Key)
	}
}
