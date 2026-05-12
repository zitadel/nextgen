package convert

import (
	_ "embed"
	"testing"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
)

func TestUserSchemaToJsonschema_Success(t *testing.T) {
	type TestCase struct {
		name     string
		input    api.UserSchema
		expected jsonschema.Schema
	}

	var exampleUserSchema api.UserSchema
	err := exampleUserSchema.UnmarshalJSON(exampleUserSchemaYaml)
	require.NoError(t, err)

	testcases := []TestCase{
		{
			name:  "generic_1",
			input: exampleUserSchema,
			expected: jsonschema.Schema{
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
							"enable":   false,
							"position": 1,
						},
						"passkey": map[string]any{
							"enable":   true,
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
		},
	}

	for _, testCase := range testcases {
		t.Run(testCase.name, func(t *testing.T) {
			out, err := UserSchemaToJsonschema(testCase.input)
			require.NoError(t, err)
			require.NotNil(t, out)
			assert.Equal(t, testCase.expected, *out)
		})
	}
}
