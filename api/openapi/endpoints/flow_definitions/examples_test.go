package flow_definitions

import (
	"embed"
	"encoding/json"
	"net/url"
	"strings"
	"testing"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

//go:embed examples/*/flow-definition.json
var exampleFlowDefinitions embed.FS

// exampleUserSchema covers every field referenced by examples/01..06 plus the
// default flow definition. Kept inline so the round-trip test does not depend
// on whatever the project's currently-shipped default schema looks like.
var exampleUserSchema = []byte(`{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.com/schemas/flow-engine-examples-user.json",
  "type": "object",
  "required": ["email"],
  "x-auth-methods": {
    "password": { "enabled": true },
    "passkey":  { "enabled": true }
  },
  "properties": {
    "email":       { "type": "string", "format": "email", "x-unique": "project" },
    "name":        { "type": "string" },
    "givenName":   { "type": "string" },
    "familyName":  { "type": "string" },
    "phoneNumber": { "type": "string" },
    "dateOfBirth": { "type": "string", "format": "date" }
  }
}`)

// TestExampleFlowDefinitions exercises every shipped example flow definition
// JSON end-to-end: substitution → API request decode + Validate → domain
// conversion + NewFlowDefinition → ValidateFlowDefinition against a user
// schema with every field the examples reference.
//
// Catches silent drift between the documented examples and what the engine
// will accept.
func TestExampleFlowDefinitions(t *testing.T) {
	t.Parallel()

	var userSchema jsonschema.Schema
	require.NoError(t, json.Unmarshal(exampleUserSchema, &userSchema))

	const (
		projectID     = "proj_example_round_trip"
		userSchemaURL = "https://example.com/schemas/flow-engine-examples-user.json"
	)

	examples := []struct {
		name string
		path string
	}{
		{"01-password-login", "examples/01-password-login/flow-definition.json"},
		{"02-password-register", "examples/02-password-register/flow-definition.json"},
		{"03-passkey-login", "examples/03-passkey-login/flow-definition.json"},
		{"04-passkey-register", "examples/04-passkey-register/flow-definition.json"},
		{"05-combined-login-register", "examples/05-combined-login-register/flow-definition.json"},
		{"06-combined-password-passkey", "examples/06-combined-password-passkey/flow-definition.json"},
	}

	for _, ex := range examples {
		t.Run(ex.name, func(t *testing.T) {
			t.Parallel()

			raw, err := exampleFlowDefinitions.ReadFile(ex.path)
			require.NoError(t, err)

			content := string(raw)
			content = strings.ReplaceAll(content, "${PROJECT_ID}", projectID)
			content = strings.ReplaceAll(content, "${USER_SCHEMA_URL}", userSchemaURL)

			req := &api.CreateFlowDefinitionRequest{}
			require.NoError(t, req.UnmarshalJSON([]byte(content)), "decode")
			require.NoError(t, req.Validate(), "api validate")

			purposes, err := convertPurposes(req.FlowDefinition.GetPurposes())
			require.NoError(t, err)

			steps, err := convertSteps(req.FlowDefinition.GetSteps())
			require.NoError(t, err)

			schemaURI := url.URL(req.GetSchemaURI().Value)
			userSchemaRef := req.FlowDefinition.GetUserSchema()
			status, err := domain.FlowDefinitionStatusString(string(req.FlowDefinition.GetStatus()))
			require.NoError(t, err, "invalid status")

			flowDef, err := domain.NewFlowDefinition(
				"",
				projectID,
				req.FlowDefinition.GetName(),
				schemaURI.String(),
				userSchemaRef,
				purposes,
				domain.FlowDefinitionAudience{
					AppIDs:  req.FlowDefinition.GetAudience().Value.AppIds,
					TeamIDs: req.FlowDefinition.GetAudience().Value.TeamIds,
				},
				steps,
				status,
			)
			require.NoError(t, err, "domain NewFlowDefinition")

			_, err = domain.ValidateFlowDefinition(&userSchema, *flowDef)
			require.NoError(t, err, "ValidateFlowDefinition")
		})
	}
}

// TestDefaultLoginFlowDefinition verifies the default-login flow the server
// embeds and installs into every new project survives the same round-trip.
func TestDefaultLoginFlowDefinition(t *testing.T) {
	t.Parallel()

	var userSchema jsonschema.Schema
	require.NoError(t, json.Unmarshal(exampleUserSchema, &userSchema))

	defs, err := DefaultLoginFlowDefinitions(
		"https://example.com",
		"proj_default_round_trip",
		"https://example.com/schemas/flow-engine-examples-user.json",
	)
	require.NoError(t, err)
	require.Len(t, defs, 1)

	_, err = domain.ValidateFlowDefinition(&userSchema, *defs[0])
	require.NoError(t, err)
}
