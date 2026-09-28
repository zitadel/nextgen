//go:build postgres_integration || spanner_integration

package integration_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/service"
)

// TestUserResponses_CarryDerivedIdentity pins ADR 058 §3a end to end: user
// responses carry the derived identifier/identifier_property/display fields,
// resolved live from each user's own schema designations, with no expand
// gate (ADR 059 rule 8).
func TestUserResponses_CarryDerivedIdentity(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	// A schema designating both identifier and display, alongside the seeded
	// default (which designates email and no display properties).
	displaySchemaURL := harness.CreateUserSchema(t, project, `{
		"title": "IdentityEnvelopeSchema",
		"metaSchema": "https://test.example.schemas.com/schemas/user-schema.json",
		"$id": "https://identity-envelope.example.com/schemas/human-user.json",
		"kind": "user-schema",
		"type": "object",
		"x-identifier": "email",
		"x-display": ["givenName", "familyName"],
		"x-auth-methods": {"password": {"enabled": true}},
		"properties": {
			"email": {"type": "string", "format": "email", "x-unique": "project"},
			"givenName": {"type": "string"},
			"familyName": {"type": "string"}
		}
	}`)

	users := harness.EnsureUserService(t)
	displayUser, err := users.CreateUser(t.Context(), service.CreateUserInput{
		ProjectID: project.ID,
		SchemaURL: displaySchemaURL,
		Attributes: map[string]any{
			"email":      "grace@identity.example.com",
			"givenName":  "Grace",
			"familyName": "Hopper",
		},
	})
	require.NoError(t, err)

	// The create read-back already carries the resolution.
	require.NotNil(t, displayUser.Ref)
	assert.Equal(t, "Grace Hopper", displayUser.Ref.Display)

	defaultUser, err := users.CreateUser(t.Context(), service.CreateUserInput{
		ProjectID:  project.ID,
		SchemaURL:  apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL),
		Attributes: map[string]any{"email": "plain@identity.example.com"},
	})
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	t.Run("query rows carry each schema's own resolution", func(t *testing.T) {
		res, err := client.QueryUsers(t.Context(), &api.QueryUsersRequest{})
		require.NoError(t, err)
		page, ok := res.(*api.QueryUsersResponse)
		require.True(t, ok, helpers.MustMarshal(t, res))

		byID := map[string]api.User{}
		for _, row := range page.Users {
			byID[string(row.ID)] = row
		}

		display := byID[displayUser.ID]
		assert.Equal(t, "grace@identity.example.com", display.Identifier.Value)
		assert.Equal(t, "email", display.IdentifierProperty.Value)
		assert.Equal(t, "Grace Hopper", display.Display.Value)

		plain := byID[defaultUser.ID]
		assert.Equal(t, "plain@identity.example.com", plain.Identifier.Value)
		assert.Equal(t, "email", plain.IdentifierProperty.Value)
		assert.False(t, plain.Display.Set, "the default schema designates no display properties")
	})

	t.Run("get by id carries the resolution", func(t *testing.T) {
		res, err := client.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: api.UserID(displayUser.ID)})
		require.NoError(t, err)
		got, ok := res.(*api.User)
		require.True(t, ok, helpers.MustMarshal(t, res))
		assert.Equal(t, "grace@identity.example.com", got.Identifier.Value)
		assert.Equal(t, "Grace Hopper", got.Display.Value)
	})
}
