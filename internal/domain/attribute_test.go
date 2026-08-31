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
			expected CreateAttributes
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
				expected: CreateAttributes{
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
				expected: CreateAttributes{
					mustNewCreateAttribute(t, "name", "dummy", AttributeUniquenessUnspecified),
					mustNewCreateAttribute(t, "email", "test@example.com", AttributeUniquenessTeam),
					mustNewCreateAttribute(t, "address.street", "main street", AttributeUniquenessUnspecified),
					mustNewCreateAttribute(t, "address.houseNumber", "32b", AttributeUniquenessUnspecified),
					mustNewCreateAttribute(t, "address.country", "madeupia", AttributeUniquenessUnspecified),
					mustNewCreateAttribute(t, "address.city", "examplus", AttributeUniquenessUnspecified),
					mustNewCreateAttribute(t, "address.zipCode", "1234AB", AttributeUniquenessProject),
				},
			},
			{
				name: "simple direct unique field",
				mapValue: map[string]any{
					"email": "test@example.com",
				},
				schema: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"email": map[string]any{
							"type":     "string",
							"x-unique": "team",
						},
					},
				},
				expected: CreateAttributes{
					mustNewCreateAttribute(t, "email", "test@example.com", AttributeUniquenessTeam),
				},
			},
			{
				name: "nested field with x-unique constraint",
				mapValue: map[string]any{
					"email": "unique@example.com",
					"address": map[string]any{
						"secondary_email": "also@example.com",
					},
				},
				schema: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"email": map[string]any{
							"type":     "string",
							"x-unique": "team",
						},
						"address": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"secondary_email": map[string]any{
									"type":     "string",
									"x-unique": "project",
								},
							},
						},
					},
				},
				expected: CreateAttributes{
					mustNewCreateAttribute(t, "email", "unique@example.com", AttributeUniquenessTeam),
					mustNewCreateAttribute(t, "address.secondary_email", "also@example.com", AttributeUniquenessProject),
				},
			},
			{
				name: "empty address",
				mapValue: map[string]any{
					"address": map[string]any{},
				},
				schema: map[string]any{
					"type": "object",
					"properties": map[string]any{
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
				expected: CreateAttributes{},
			},
		}

		for _, tc := range tcs {
			t.Run(tc.name, func(t *testing.T) {
				as, err := CreateAttributesFromMap(tc.mapValue, tc.schema)
				assert.NoError(t, err)
				assert.Equal(t, len(tc.expected), len(as))
				for _, a := range as {
					assert.Contains(t, tc.expected, a)
				}
			})
		}
	})
}

func TestAttributes_ToMap(t *testing.T) {
	t.Parallel()

	t.Run("ok", func(t *testing.T) {
		t.Parallel()

		tcs := []struct {
			name       string
			attributes Attributes
			expected   map[string]any
		}{
			{
				name: "single layer",
				attributes: Attributes{
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
				attributes: Attributes{
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
			{
				name: "nested beyond one level",
				attributes: Attributes{
					{"email", "test@example.com"},
					{"address.street", "main street"},
					{"address.geo.latitude", 45.0},
					{"address.geo.datum.reference.epsg", "EPSG:4326"},
				},
				expected: map[string]any{
					"email": "test@example.com",
					"address": map[string]any{
						"street": "main street",
						"geo": map[string]any{
							"latitude": 45.0,
							"datum": map[string]any{
								"reference": map[string]any{
									"epsg": "EPSG:4326",
								},
							},
						},
					},
				},
			},
		}

		for _, tc := range tcs {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()

				m, err := tc.attributes.ToMap()
				assert.NoError(t, err)
				assert.EqualValues(t, tc.expected, m)
			})
		}
	})

	t.Run("error", func(t *testing.T) {
		t.Parallel()

		// A scalar and a path descending through the same node cannot both
		// be written: the second write would have to traverse into a string.
		attrs := Attributes{
			{"address", "main street"},
			{"address.city", "examplus"},
		}

		_, err := attrs.ToMap()
		assert.ErrorContains(t, err, "address")
	})
}

func mustNewCreateAttribute(t *testing.T, key AttributeKey, value any, unique AttributeUniqueness) CreateAttribute {
	t.Helper()
	a, err := NewCreateAttribute(key, value, unique)
	require.NoError(t, err)
	return *a
}

func TestUniqueValueHash(t *testing.T) {
	upper, err := UniqueValueHash("Alice@Example.COM")
	require.NoError(t, err)
	lower, err := UniqueValueHash("alice@example.com")
	require.NoError(t, err)
	assert.Equal(t, upper, lower, "casings of one string are one unique value")

	eszett, err := UniqueValueHash("straße")
	require.NoError(t, err)
	folded, err := UniqueValueHash("STRASSE")
	require.NoError(t, err)
	assert.Equal(t, eszett, folded, "case folding is Unicode, not ASCII")

	other, err := UniqueValueHash("bob@example.com")
	require.NoError(t, err)
	assert.NotEqual(t, lower, other)

	num, err := UniqueValueHash(42)
	require.NoError(t, err)
	str, err := UniqueValueHash("42")
	require.NoError(t, err)
	assert.NotEqual(t, num, str, "non-strings hash as encoded, distinct from strings")
}

func TestNewCreateAttribute_UniqueHashIsNormalized(t *testing.T) {
	a, err := NewCreateAttribute("email", "Alice@Example.com", AttributeUniquenessProject)
	require.NoError(t, err)
	b, err := NewCreateAttribute("email", "alice@example.com", AttributeUniquenessProject)
	require.NoError(t, err)

	assert.Equal(t, a.ValueHash, b.ValueHash, "the registry sees one value")
	assert.Equal(t, "Alice@Example.com", a.Value, "the stored value keeps its casing")
}
