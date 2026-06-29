package database_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestCoerceStringValue(t *testing.T) {
	got, err := database.CoerceStringValue("proj_1")
	require.NoError(t, err)
	assert.Equal(t, "proj_1", got)

	_, err = database.CoerceStringValue(1)
	assert.Error(t, err)
}

func TestCoerceTimeValue(t *testing.T) {
	createdAt := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)

	got, err := database.CoerceTimeValue(createdAt)
	require.NoError(t, err)
	assert.Equal(t, createdAt, got)

	got, err = database.CoerceTimeValue("2026-01-02T03:04:05Z")
	require.NoError(t, err)
	assert.Equal(t, createdAt, got)

	_, err = database.CoerceTimeValue("not-a-time")
	assert.Error(t, err)
}

func TestCoerceNumberValue(t *testing.T) {
	got, err := database.CoerceNumberValue[domain.FlowDefinitionStatus](float64(domain.FlowDefinitionStatusActive))
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionStatusActive, got)

	got, err = database.CoerceNumberValue[domain.FlowDefinitionStatus](domain.FlowDefinitionStatusDraft)
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionStatusDraft, got)
}

func TestCoerceSliceString(t *testing.T) {
	got, err := database.CoerceSlice([]any{"https://a.example", "https://b.example"}, database.CoerceStringValue)
	require.NoError(t, err)
	assert.Equal(t, []string{"https://a.example", "https://b.example"}, got)

	orig := []string{"https://a.example"}
	got, err = database.CoerceSlice(orig, database.CoerceStringValue)
	require.NoError(t, err)
	assert.Equal(t, orig, got)
}

func TestCoerceSliceAsAnyJSON(t *testing.T) {
	raw := []any{map[string]any{"name": "login"}}
	coerce := database.CoerceSliceAsAny(database.CoerceJSONValue[domain.FlowDefinitionStep])

	got, err := coerce(raw)
	require.NoError(t, err)
	steps, ok := got.([]domain.FlowDefinitionStep)
	require.True(t, ok)
	require.Len(t, steps, 1)
	assert.Equal(t, "login", steps[0].Name)
}

func TestCoerceJSONValueStruct(t *testing.T) {
	raw := map[string]any{
		"AppIDs": []any{"app1"},
	}
	got, err := database.CoerceJSONValue[domain.FlowDefinitionAudience](raw)
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionAudience{AppIDs: []string{"app1"}}, got)
}

func TestCoerceEnumKeyMap(t *testing.T) {
	parseKey := func(s string) (domain.FlowDefinitionPurpose, error) {
		return domain.FlowDefinitionPurposeString(s)
	}

	got, err := database.CoerceEnumKeyMap[domain.FlowDefinitionPurpose, string](
		map[string]any{"login": "login-step"},
		parseKey,
	)
	require.NoError(t, err)
	assert.Equal(t, map[domain.FlowDefinitionPurpose]string{
		domain.FlowDefinitionPurposeLogin: "login-step",
	}, got)
}
