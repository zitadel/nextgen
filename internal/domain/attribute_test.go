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
									"type":     "string",
									"x-unique": "project",
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
					mustNewCreateAttribute(t, "address.zipCode", "1234AB", AttributeUniquenessProject),
				},
			},
		}

		for _, tc := range tcs {
			t.Run(tc.name, func(t *testing.T) {
				as, err := FlattenMapToCreateAttributes(tc.mapValue, tc.schema, "")
				assert.NoError(t, err)
				assert.Equal(t, len(tc.expected), len(as))
				for _, a := range as {
					assert.Contains(t, tc.expected, a)
				}
			})
		}
	})
}

func TestBuildAttributeTree(t *testing.T) {
	t.Run("ok", func(t *testing.T) {
		tcs := []struct {
			name       string
			attributes []Attribute
			expected   map[string]any
		}{
			{
				name: "single layer",
				attributes: []Attribute{
					{Key: "name", Value: "dummy"},
					{Key: "email", Value: "test@example.com"},
				},
				expected: map[string]any{
					"name":  "dummy",
					"email": "test@example.com",
				},
			},
			{
				name: "multi layer",
				attributes: []Attribute{
					{"name", "dummy"},
					{"email", "test@example.com"},
					{"address.street", "main street"},
					{"address.houseNumber", "32b"},
					{"address.country", "madeupia"},
					{"address.city", "examplus"},
					{"address.zipCode", "1234AB"},
				},
				expected: map[string]any{
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
			},
		}

		for _, tc := range tcs {
			t.Run(tc.name, func(t *testing.T) {
				m, err := BuildAttributeTree(tc.attributes)
				assert.NoError(t, err)
				assert.EqualValues(t, tc.expected, m)
			})
		}
	})
}

func mustNewCreateAttribute(t *testing.T, key string, value any, unique AttributeUniqueness) *CreateAttribute {
	t.Helper()
	a, err := NewCreateAttribute(key, value, unique)
	require.NoError(t, err)
	return a
}
