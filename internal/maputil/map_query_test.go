package maputil

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGet(t *testing.T) {
	t.Run("string", func(t *testing.T) {
		expected := "value"
		v, ok := Get[string](map[string]any{"property": expected}, "property")
		assert.True(t, ok)
		assert.Equal(t, expected, v)
	})

	t.Run("int", func(t *testing.T) {
		expected := 123
		v, ok := Get[int](map[string]any{"int_property": expected}, "int_property")
		assert.True(t, ok)
		assert.Equal(t, expected, v)
	})

	t.Run("map", func(t *testing.T) {
		expected := map[string]any{
			"property": "value",
		}
		v, ok := Get[map[string]any](map[string]any{"nested_object": expected}, "nested_object")
		assert.True(t, ok)
		assert.Equal(t, expected, v)
	})

	t.Run("non existing key", func(t *testing.T) {
		v, ok := Get[string](map[string]any{}, "property")
		assert.False(t, ok)
		assert.Empty(t, v)
	})

	t.Run("invalid cast", func(t *testing.T) {
		v, ok := Get[int](map[string]any{"property": "value"}, "property")
		assert.False(t, ok)
		assert.Empty(t, v)
	})
}

func TestGetNested(t *testing.T) {
	t.Run("single level", func(t *testing.T) {
		expected := "value"
		v, ok := GetNested[string](map[string]any{"property": expected}, "property")
		assert.True(t, ok)
		assert.Equal(t, expected, v)
	})

	t.Run("multi level", func(t *testing.T) {
		expected := "value"
		m := map[string]any{
			"level1": map[string]any{
				"level2": map[string]any{
					"level3": expected,
				},
			},
		}
		v, ok := GetNested[string](m, "level1.level2.level3")
		assert.True(t, ok)
		assert.Equal(t, expected, v)
	})

	t.Run("non existing path", func(t *testing.T) {
		m := map[string]any{
			"user": map[string]any{
				"address": map[string]any{
					"houseNumber": "10A",
				},
			},
		}
		v, ok := GetNested[string](m, "user.address.building")
		assert.False(t, ok)
		assert.Empty(t, v)
	})

	t.Run("invalid cast", func(t *testing.T) {
		m := map[string]any{
			"user": map[string]any{
				"address": map[string]any{
					"houseNumber": "10A",
				},
			},
		}
		v, ok := GetNested[int](m, "user.address.houseNumber")
		assert.False(t, ok)
		assert.Empty(t, v)
	})
}
