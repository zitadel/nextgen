//go:build postgres_integration || spanner_integration

package integration_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
)

// TestFlowStepRendersSSOProvidersFromConnection covers a step whose
// sso_providers name connection slugs: the rendered step carries the
// connection's display name and template at its newest revision, a slug with
// no connection is dropped, and the stored definition keeps the raw slugs.
func TestFlowStepRendersSSOProvidersFromConnection(t *testing.T) {
	t.Parallel()
	f := newIdpFixture(t)
	f.create(t, helpers.OIDCConnection("google"))

	defResp, err := f.client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID:      f.projectID(),
		FlowDefinition: ssoLoginFlowDefinition(apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)),
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, defResp, "create flow definition: %s", helpers.MustMarshal(t, defResp))
	definitionID := defResp.(*api.FlowDefinitionResponse).ID

	createResp, err := f.client.CreateFlow(t.Context(), &api.CreateFlowRequest{
		ProjectID: f.projectID(),
		Purpose:   api.CreateFlowRequestPurposeLogin,
	}, api.CreateFlowParams{})
	require.NoError(t, err)
	require.IsType(t, &api.FlowResponseHeaders{}, createResp, helpers.MustMarshal(t, createResp))
	flowHeaders := createResp.(*api.FlowResponseHeaders)
	require.Equal(t, "identifier", flowHeaders.Response.Step.Name)
	require.Equal(t, []api.SSOProvider{{ID: "google", Name: "Google", Template: ""}}, flowHeaders.Response.Step.SSOProviders,
		"the slug without a connection is dropped; a connection without template renders an empty one")

	renamed := helpers.OIDCConnection("google")
	renamed.DisplayName = "Google Workspace"
	renamed.Template = api.NewOptString("google")
	f.revise(t, renamed)

	stepResp, err := f.client.GetFlowStep(t.Context(), api.GetFlowStepParams{
		ID:    flowHeaders.Response.ID,
		Zflow: mustExtractZflow(t, flowHeaders.SetCookie.Value),
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowResponse{}, stepResp, helpers.MustMarshal(t, stepResp))
	require.Equal(t, []api.SSOProvider{{ID: "google", Name: "Google Workspace", Template: "google"}}, stepResp.(*api.FlowResponse).Step.SSOProviders,
		"every render reads the connection's newest revision")

	getResp, err := f.client.GetFlowDefinition(t.Context(), api.GetFlowDefinitionParams{ID: definitionID})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, getResp, helpers.MustMarshal(t, getResp))
	require.Equal(t, []string{"google", "gone"}, getResp.(*api.FlowDefinitionResponse).FlowDefinition.Steps[0].SSOProviders,
		"the definition stores slugs, not the rendered providers")
}

func ssoLoginFlowDefinition(userSchema string) api.FlowDefinition {
	return api.FlowDefinition{
		Name:       "sso-login",
		Status:     "active",
		UserSchema: userSchema,
		Purposes:   api.FlowDefinitionPurposes{"login": "identifier"},
		Steps: []api.FlowDefinitionStep{
			{
				Name:         "identifier",
				Fields:       []string{"email"},
				SSOProviders: []string{"google", "gone"},
				Actions: []api.StepAction{
					{Name: "submit", Kind: api.StepActionKindSubmit, Primary: api.NewOptBool(true)},
				},
				Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
					"submit":   api.FlowDefinitionStepTransitionsItem{Target: "done"},
					"callback": api.FlowDefinitionStepTransitionsItem{Target: "done"},
				}),
			},
			{
				Name:     "done",
				Complete: api.NewOptFlowDefinitionStepComplete(api.FlowDefinitionStepCompleteShow),
			},
		},
	}
}
