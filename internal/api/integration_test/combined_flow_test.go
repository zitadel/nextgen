//go:build postgres_integration || spanner_integration

package integration_test

import (
	"testing"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
)

// TestCombinedFlowLoginFlipToRegister exercises example 05 (combined password
// login + register): a login attempt with an unknown email auto-flips into
// the register sub-flow, completes registration, and the new user lands in
// the database.
//
// State-machine unit tests cover the flip outcome
// (TestFlowStateMachine_FlipTable_LoginUserNotFoundFlipsToRegister); this
// drives the same behavior through the real HTTP service so the cookie
// rotation + service-layer dispatch don't regress.
func TestCombinedFlowLoginFlipToRegister(t *testing.T) {
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)

	server := harness.EnsureTestServer(t)
	client, err := helpers.NewApiClient(server.URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	defResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID:      api.ProjectID(project.ID),
		FlowDefinition: combinedPasswordFlowDefinition(schemaURL),
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionDetailResponse{}, defResp, "create flow definition: %s", helpers.MustMarshal(t, defResp))

	createResp, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{
		ProjectID: api.ProjectID(project.ID),
		Purpose:   api.CreateFlowRequestPurposeLogin,
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowResponseHeaders{}, createResp, helpers.MustMarshal(t, createResp))
	flowHeaders := createResp.(*api.FlowResponseHeaders)
	flowID := flowHeaders.Response.ID
	require.Equal(t, "identifier", flowHeaders.Response.Step.Name)
	zflow := mustExtractZflow(t, flowHeaders.SetCookie.Value)

	const (
		newEmail = "flip-flow@example.com"
		newPass  = "very-good-password-1"
	)

	// Submit unknown identifier → server flips to register-identifier.
	flipResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "submit",
		Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{
			"email": jx.Raw(`"` + newEmail + `"`),
		}),
	}, api.SubmitFlowStepParams{
		ID:    flowID,
		Zflow: zflow,
	})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, flipResp, helpers.MustMarshal(t, flipResp))
	flipOK := flipResp.(*api.SubmitFlowStepOK)
	require.Equal(t, "register-identifier", flipOK.Response.Step.Name, "user_not_found must flip to register-identifier")
	zflow = mustExtractZflow(t, flipOK.SetCookie.Value)

	// Complete the register-identifier step. The default schema collects only
	// email (the minimal use case), so that is all the register step carries.
	idResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "submit",
		Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{
			"email": jx.Raw(`"` + newEmail + `"`),
		}),
	}, api.SubmitFlowStepParams{
		ID:    flowID,
		Zflow: zflow,
	})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, idResp, helpers.MustMarshal(t, idResp))
	idOK := idResp.(*api.SubmitFlowStepOK)
	require.Equal(t, "register-password", idOK.Response.Step.Name)
	zflow = mustExtractZflow(t, idOK.SetCookie.Value)

	// Submit the password → create_user fires → done + handoff token.
	pwResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "submit",
		Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{
			"x-auth-methods#password": jx.Raw(`"` + newPass + `"`),
		}),
	}, api.SubmitFlowStepParams{
		ID:    flowID,
		Zflow: zflow,
	})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, pwResp, helpers.MustMarshal(t, pwResp))
	pwOK := pwResp.(*api.SubmitFlowStepOK)
	require.Equal(t, "done", pwOK.Response.Step.Name)
	require.True(t, pwOK.Response.Step.Complete.Set, "expected terminal step")

	handoffToken, hasToken := pwOK.Response.HandoffToken.Get()
	require.True(t, hasToken, "create_user via flip must issue a handoff token")
	require.NotEmpty(t, handoffToken)

	// User row landed in the DB with the flipped-into email.
	users := harness.EnsureUserFixture(t)
	_, err = users.GetByAttributes(t.Context(), project.ID, []domain.Attribute{{Key: "email", Value: newEmail}})
	require.NoError(t, err, "flip-into-register must persist exactly one user")
}

// combinedPasswordFlowDefinition mirrors examples/05-combined-login-register
// using fields available on the default-human-user schema.
func combinedPasswordFlowDefinition(userSchema string) api.FlowDefinition {
	createUser := api.FlowDefinitionStepOnSuccessCreateUser
	return api.FlowDefinition{
		Name:       "combined-password",
		Status:     "active",
		UserSchema: userSchema,
		Purposes: api.FlowDefinitionPurposes{
			"login":    "identifier",
			"register": "register-identifier",
		},
		Steps: []api.FlowDefinitionStep{
			{
				Name:   "identifier",
				Fields: []string{"email"},
				Actions: []api.StepAction{
					{Name: "submit", Kind: api.StepActionKindSubmit, Primary: api.NewOptBool(true)},
					{Name: "register", Kind: api.StepActionKindSubmit},
				},
				Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
					"submit":         api.FlowDefinitionStepTransitionsItem{Target: "password"},
					"register":       api.FlowDefinitionStepTransitionsItem{Target: "register-identifier"},
					"user_not_found": api.FlowDefinitionStepTransitionsItem{Target: "register-identifier"},
				}),
			},
			{
				Name:   "password",
				Fields: []string{"x-auth-methods#password"},
				Actions: []api.StepAction{
					{Name: "submit", Kind: api.StepActionKindSubmit, Primary: api.NewOptBool(true)},
				},
				Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
					"submit": api.FlowDefinitionStepTransitionsItem{Target: "done"},
				}),
			},
			{
				Name:   "register-identifier",
				Fields: []string{"email"},
				Actions: []api.StepAction{
					{Name: "submit", Kind: api.StepActionKindSubmit, Primary: api.NewOptBool(true)},
					{Name: "login", Kind: api.StepActionKindSubmit},
				},
				Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
					"submit":              api.FlowDefinitionStepTransitionsItem{Target: "register-password"},
					"login":               api.FlowDefinitionStepTransitionsItem{Target: "identifier"},
					"user_already_exists": api.FlowDefinitionStepTransitionsItem{Target: "password"},
				}),
			},
			{
				Name:      "register-password",
				Fields:    []string{"x-auth-methods#password"},
				OnSuccess: api.NewOptFlowDefinitionStepOnSuccess(createUser),
				Actions: []api.StepAction{
					{Name: "submit", Kind: api.StepActionKindSubmit, Primary: api.NewOptBool(true)},
				},
				Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
					"submit": api.FlowDefinitionStepTransitionsItem{Target: "done"},
				}),
			},
			{
				Name:     "done",
				Complete: api.NewOptFlowDefinitionStepComplete(api.FlowDefinitionStepCompleteShow),
			},
		},
	}
}
