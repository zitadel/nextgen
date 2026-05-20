package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFlattenMapToCreateAttributes(t *testing.T) {
	t.Run("ok", func(t *testing.T) {
		tcs := []struct {
			name     string
			mapValue map[string]any
			schema   map[string]any
			expected []*CreateAttribute
		}{
			{
				name: "single layer",
				mapValue: map[string]any{
					"name":  "dummy",
					"email": "test@example.com",
				},
				schema: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"name": map[string]any{
							"type": "string",
						},
						"email": map[string]any{
							"type":     "string",
							"format":   "email",
							"x-unique": "team",
						},
					},
				},
				expected: []*CreateAttribute{
					mustNewCreateAttribute(t, "name", "dummy", AttributeUniquenessUnspecified),
					mustNewCreateAttribute(t, "email", "test@example.com", AttributeUniquenessTeam),
				},
			},
			{
				name: "multi layer",
				mapValue: map[string]any{
					"email": "test@example.com",
					"name":  "dummy",
					"address": map[string]any{
						"country":     "madeupia",
						"zipCode":     "1234AB",
						"city":        "examplus",
						"street":      "main street",
						"houseNumber": "32b",
					},
				},
				schema: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"email": map[string]any{
							"type":     "string",
							"format":   "email",
							"x-unique": "team",
						},
						"name": map[string]any{
							"type": "string",
						},
						"address": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"street": map[string]any{
									"type": "string",
								},
								"houseNumber": map[string]any{
									"type": "string",
								},
								"city": map[string]any{
									"type": "string",
								},
								"zipCode": map[string]any{
									"type": "string",
								},
								"country": map[string]any{
									"type": "string",
								},
							},
						},
					},
				},
				expected: []*CreateAttribute{
					mustNewCreateAttribute(t, "name", "dummy", AttributeUniquenessUnspecified),
					mustNewCreateAttribute(t, "email", "test@example.com", AttributeUniquenessTeam),
					mustNewCreateAttribute(t, "address.street", "main street", AttributeUniquenessUnspecified),
					mustNewCreateAttribute(t, "address.houseNumber", "32b", AttributeUniquenessUnspecified),
					mustNewCreateAttribute(t, "address.country", "madeupia", AttributeUniquenessUnspecified),
					mustNewCreateAttribute(t, "address.city", "examplus", AttributeUniquenessUnspecified),
					mustNewCreateAttribute(t, "address.zipCode", "1234AB", AttributeUniquenessUnspecified),
				},
			},
		}

		for _, tc := range tcs {
			t.Run(tc.name, func(t *testing.T) {
				as, err := FlattenMapToCreateAttributes(tc.mapValue, tc.schema, "")
				assert.NoError(t, err)
				assert.EqualValues(t, tc.expected, as)
			})
		}
	})
}

func mustNewCreateAttribute(t *testing.T, key string, value any, unique AttributeUniqueness) *CreateAttribute {
	a, err := NewCreateAttribute(key, value, unique)
	require.NoError(t, err)
	return a
}
