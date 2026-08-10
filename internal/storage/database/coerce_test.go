package database_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestCoerceStringValue(t *testing.T) {
	t.Parallel()
	got, err := database.CoerceStringValue("proj_1")
	require.NoError(t, err)
	assert.Equal(t, "proj_1", got)

	_, err = database.CoerceStringValue(1)
	assert.Error(t, err)
}

func TestCoerceBytesValue(t *testing.T) {
	t.Parallel()
	got, err := database.CoerceBytesValue([]byte{0x01, 0x02})
	require.NoError(t, err)
	assert.Equal(t, []byte{0x01, 0x02}, got)

	got, err = database.CoerceBytesValue("ab")
	require.NoError(t, err)
	assert.Equal(t, []byte("ab"), got)

	_, err = database.CoerceBytesValue(1)
	assert.Error(t, err)
}

func TestCoerceBoolValue(t *testing.T) {
	t.Parallel()
	got, err := database.CoerceBoolValue(true)
	require.NoError(t, err)
	assert.True(t, got)

	gotAny, err := database.CoerceBool(false)
	require.NoError(t, err)
	assert.Equal(t, false, gotAny)

	_, err = database.CoerceBoolValue("true")
	assert.Error(t, err)
}

func TestCoerceTimeValue(t *testing.T) {
	t.Parallel()
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

func TestCoerceTime_nil(t *testing.T) {
	t.Parallel()
	got, err := database.CoerceTime(nil)
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestCoerceString_nil(t *testing.T) {
	t.Parallel()
	got, err := database.CoerceString(nil)
	require.NoError(t, err)
	assert.Nil(t, got)

	_, err = database.CoerceStringValue(nil)
	assert.Error(t, err)
}

func TestNullableValue(t *testing.T) {
	t.Parallel()

	// assert.Nil would also accept a typed nil, which is the exact bug
	// NullableValue exists to prevent; == nil pins the untyped form.
	assert.True(t, database.NullableValue[string](nil) == nil)
	assert.True(t, database.NullableValue[time.Time](nil) == nil)

	assert.Equal(t, "usr_1", database.NullableValue(new("usr_1")))
}

func TestCoerceNumberValue(t *testing.T) {
	t.Parallel()
	got, err := database.CoerceNumberValue[domain.FlowDefinitionStatus](float64(domain.FlowDefinitionStatusActive))
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionStatusActive, got)

	got, err = database.CoerceNumberValue[domain.FlowDefinitionStatus](domain.FlowDefinitionStatusDraft)
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionStatusDraft, got)
}

func TestCoerceSliceString(t *testing.T) {
	t.Parallel()
	got, err := database.CoerceSlice([]any{"https://a.example", "https://b.example"}, database.CoerceStringValue)
	require.NoError(t, err)
	assert.Equal(t, []string{"https://a.example", "https://b.example"}, got)

	orig := []string{"https://a.example"}
	got, err = database.CoerceSlice(orig, database.CoerceStringValue)
	require.NoError(t, err)
	assert.Equal(t, orig, got)
}

func TestCoerceSliceAsAnyJSON(t *testing.T) {
	t.Parallel()
	raw := []any{map[string]any{"name": "login"}}
	coerce := database.CoerceSliceAsAny(database.CoerceJSONValue[domain.FlowDefinitionStep])

	got, err := coerce(raw)
	require.NoError(t, err)
	require.IsType(t, []domain.FlowDefinitionStep{}, got)
	steps := got.([]domain.FlowDefinitionStep)
	require.Len(t, steps, 1)
	assert.Equal(t, "login", steps[0].Name)
}

func TestCoerceJSONValueStruct(t *testing.T) {
	t.Parallel()
	raw := map[string]any{
		"AppIDs": []any{"app1"},
	}
	got, err := database.CoerceJSONValue[domain.FlowDefinitionAudience](raw)
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionAudience{AppIDs: []string{"app1"}}, got)
}

func TestCoerceEnumKeyMap(t *testing.T) {
	t.Parallel()
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
