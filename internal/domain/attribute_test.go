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
				assert.Equal(t, len(tc.expected), len(as))
				for _, a := range as {
					assert.Contains(t, tc.expected, a)
				}
			})
		}
	})

	t.Run("nested map with schema properties - should preserve nested attributes", func(t *testing.T) {
		// This test demonstrates the bug: when schema lookup succeeds (ok && props != nil),
		// the recursion is skipped, causing nested attributes to be silently dropped.
		// The schema uses the standard nested structure: properties.address.properties.*
		mapValue := map[string]any{
			"name": "John",
			"address": map[string]any{
				"street":  "Main St",
				"zipCode": "12345",
			},
		}

		schema := map[string]any{
			"type": "object",
			"properties": map[string]any{
				"name": map[string]any{
					"type": "string",
				},
				"address": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"street": map[string]any{
							"type": "string",
						},
						"zipCode": map[string]any{
							"type": "string",
						},
					},
				},
			},
		}

		as, err := FlattenMapToCreateAttributes(mapValue, schema, "")
		assert.NoError(t, err)

		// Should have 3 attributes: name, address.street, address.zipCode
		assert.Equal(t, 3, len(as))
		assert.Contains(t, as, mustNewCreateAttribute(t, "name", "John", AttributeUniquenessUnspecified))
		assert.Contains(t, as, mustNewCreateAttribute(t, "address.street", "Main St", AttributeUniquenessUnspecified))
		assert.Contains(t, as, mustNewCreateAttribute(t, "address.zipCode", "12345", AttributeUniquenessUnspecified))
	})

	t.Run("simple direct field", func(t *testing.T) {
		// Simplest test: just a single direct field
		mapValue := map[string]any{
			"email": "test@example.com",
		}

		schema := map[string]any{
			"type": "object",
			"properties": map[string]any{
				"email": map[string]any{
					"type":     "string",
					"x-unique": "team",
				},
			},
		}

		as, err := FlattenMapToCreateAttributes(mapValue, schema, "")
		assert.NoError(t, err)
		assert.Equal(t, 1, len(as), "should have 1 attribute")
		assert.Equal(t, "email", as[0].Key)
		assert.Equal(t, AttributeUniquenessTeam, as[0].UniqueScope)
	})

	t.Run("nested field with x-unique should be detected - Bug: x-unique lookup path is not adjusted for recursive calls", func(t *testing.T) {
		// This test demonstrates the x-unique lookup bug:
		// When recursing into nested objects, the schema is passed as the nested sub-schema,
		// but the x-unique lookup at line ~105 uses "properties."+key+".x-unique" regardless.
		// This path assumes the schema is always at the root level with a "properties" wrapper,
		// so nested field uniqueness constraints are never found.
		//
		// Example: For a nested field address.email with x-unique: project in its schema definition,
		// the recursive call gets the address properties as schema, but then looks for
		// "properties.email.x-unique" instead of just "email.x-unique" or adjusting the path.

		mapValue := map[string]any{
			"email": "unique@example.com", // direct field
			"address": map[string]any{
				"secondary_email": "also@example.com", // nested field with x-unique
			},
		}

		schema := map[string]any{
			"type": "object",
			"properties": map[string]any{
				"email": map[string]any{
					"type":     "string",
					"x-unique": "team", // direct field has x-unique
				},
				"address": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"secondary_email": map[string]any{
							"type":     "string",
							"x-unique": "project", // nested field has x-unique
						},
					},
				},
			},
		}

		as, err := FlattenMapToCreateAttributes(mapValue, schema, "")
		assert.NoError(t, err)

		// Should have 2 attributes: email and address.secondary_email
		if len(as) != 2 {
			t.Logf("DEBUG: Expected 2 attributes, got %d. Attributes: %+v", len(as), as)
		}
		assert.Equal(t, 2, len(as), "should have email and address.secondary_email")

		// Verify direct field uniqueness is detected (this should work)
		emailAttr := findAttrByKey(as, "email")
		if emailAttr != nil {
			assert.Equal(t, AttributeUniquenessTeam, emailAttr.UniqueScope,
				"email should have team uniqueness (direct fields work)")
		}

		// Verify nested field uniqueness is detected
		secondaryEmailAttr := findAttrByKey(as, "address.secondary_email")
		if secondaryEmailAttr != nil {
			// BUG: This will fail because x-unique for nested fields is never detected
			// The lookup path "properties.secondary_email.x-unique" doesn't exist in the nested schema
			assert.Equal(t, AttributeUniquenessProject, secondaryEmailAttr.UniqueScope,
				"address.secondary_email should have project uniqueness (demonstrates x-unique lookup bug for nested fields)")
		} else {
			t.Error("address.secondary_email attribute should exist but was not found - nested attributes are being dropped!")
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

func findAttrByKey(attrs []*CreateAttribute, key string) *CreateAttribute {
	for _, a := range attrs {
		if a.Key == key {
			return a
		}
	}
	return nil
}
