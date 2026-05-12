package convert

import (
	_ "embed"
	"fmt"
	"testing"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
)

//go:embed test_data/user-schema-example.json
var exampleUserSchemaYaml []byte

func TestJsonschemaToUserSchema(t *testing.T) {
	type TestCase struct {
		name     string
		input    jsonschema.Schema
		expected api.UserSchema
	}

	var exampleUserSchema api.UserSchema
	err := exampleUserSchema.UnmarshalJSON(exampleUserSchemaYaml)
	require.NoError(t, err)

	testcases := []TestCase{
		{
			name: "generic_1",
			input: jsonschema.Schema{
				Title:       "ExampleUserSchema",
				ID:          "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml",
				Schema:      "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/user-schema.yaml",
				Type:        "object",
				Description: "This is an example of a user schema definition.",
				Required:    []string{"email", "password"},
				Extra: map[string]any{
					"kind": "user-schema",
					"x-auth-methods": map[string]any{
						"password": map[string]any{
							"enabled":  false,
							"position": 1,
						},
						"passkey": map[string]any{
							"enabled":  true,
							"position": 2,
						},
					},
				},
				Properties: map[string]*jsonschema.Schema{
					"email":     {Type: "string", Format: "email", Description: "The user's email address."},
					"password":  {Type: "string", MinLength: new(8), Description: "The user's password, which must be at least 8 characters long."},
					"firstName": {Type: "string", Description: "The user's first name."},
					"lastName":  {Type: "string", Description: "The user's last name."},
					"address": {
						Type:        "object",
						Description: "The user's address information.",
						Properties: map[string]*jsonschema.Schema{
							"street":      {Type: "string", Description: "The street address."},
							"houseNumber": {Type: "string", Description: "The house number of the address."},
							"city":        {Type: "string", Description: "The city of the address."},
							"postalCode":  {Type: "string", Description: "The postal code of the address."},
							"country":     {Type: "string", Description: "The country of the address."},
						},
					},
				},
			},
			expected: exampleUserSchema,
		},
	}

	for _, testCase := range testcases {
		t.Run(testCase.name, func(t *testing.T) {
			out, err := JsonschemaToUserSchema(&testCase.input)
			require.NoError(t, err)
			require.NotNil(t, out)

			assert.Equal(t, testCase.expected.Schema, out.Schema)
			assert.Equal(t, testCase.expected.ID, out.ID)
			assert.Equal(t, testCase.expected.Kind, out.Kind)
			assert.Equal(t, testCase.expected.Type, out.Type)
			assert.Equal(t, testCase.expected.Title, out.Title)
			assert.Equal(t, testCase.expected.Description, out.Description)
			assert.Equal(t, testCase.expected.XMinusAuthMinusMethods, out.XMinusAuthMinusMethods)
			assert.Equal(t, testCase.expected.Required, out.Required)

			for key, expectedRaw := range testCase.expected.Properties.Value {
				actualRaw, ok := out.Properties.Value[key]
				if !assert.True(t, ok, fmt.Sprintf("Properties[%q] missing", key)) {
					continue
				}

				expectedSchema, err := rawToSchema(expectedRaw)
				require.NoError(t, err)
				actualSchema, err := rawToSchema(actualRaw)
				require.NoError(t, err)
				assert.Equal(t, expectedSchema, actualSchema)
			}
		})
	}
}
