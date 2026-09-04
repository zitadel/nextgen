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
	require.IsType(t, &api.FlowDefinitionResponse{}, defResp, "create flow definition: %s", helpers.MustMarshal(t, defResp))

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

// TestPurposeNavRotatesAuthAttempt drives review finding #829-r2-1 through
// the real HTTP service and auth-attempt domain: after login resolves an
// existing user, the attempt carries that user as a factor, and
// PrepareUserChallenge refuses a second user challenge on it. The declared
// re-purpose ("Sign up" navigation) must rotate the attempt in lockstep —
// without the rotation this path dies with "The user was already
// authenticated" instead of reaching user_already_exists → password. The
// toggle loop also pins the cookie-size bound: purpose-entry toggling is
// coalesced as an undo, so the encrypted _zflow value must not grow.
func TestPurposeNavRotatesAuthAttempt(t *testing.T) {
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)

	server := harness.EnsureTestServer(t)
	client, err := helpers.NewApiClient(server.URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	defResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID:      api.ProjectID(project.ID),
		FlowDefinition: purposeNavFlowDefinition(schemaURL),
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, defResp, "create flow definition: %s", helpers.MustMarshal(t, defResp))

	const (
		email    = "purpose-nav@example.com"
		password = "very-good-password-1"
	)

	// Seed the existing user through a registration flow.
	regResp, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{
		ProjectID: api.ProjectID(project.ID),
		Purpose:   api.CreateFlowRequestPurposeRegister,
	})
	require.NoError(t, err)
	regHeaders := regResp.(*api.FlowResponseHeaders)
	regID := regHeaders.Response.ID
	regZflow := mustExtractZflow(t, regHeaders.SetCookie.Value)

	regIDResp := mustSubmitOK(t, client, regID, regZflow, "submit", api.FlowSubmitRequestFields{
		"email": jx.Raw(`"` + email + `"`),
	})
	require.Equal(t, "register-password", regIDResp.Response.Step.Name)
	regZflow = mustExtractZflow(t, regIDResp.SetCookie.Value)

	regDone := mustSubmitOK(t, client, regID, regZflow, "submit", api.FlowSubmitRequestFields{
		"x-auth-methods#password": jx.Raw(`"` + password + `"`),
	})
	require.Equal(t, "done", regDone.Response.Step.Name)

	// Login flow: resolve the existing user onto the attempt.
	loginResp, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{
		ProjectID: api.ProjectID(project.ID),
		Purpose:   api.CreateFlowRequestPurposeLogin,
	})
	require.NoError(t, err)
	loginHeaders := loginResp.(*api.FlowResponseHeaders)
	flowID := loginHeaders.Response.ID
	require.Equal(t, "identifier", loginHeaders.Response.Step.Name)
	zflow := mustExtractZflow(t, loginHeaders.SetCookie.Value)

	identified := mustSubmitOK(t, client, flowID, zflow, "submit", api.FlowSubmitRequestFields{
		"email": jx.Raw(`"` + email + `"`),
	})
	require.Equal(t, "password", identified.Response.Step.Name)
	zflow = mustExtractZflow(t, identified.SetCookie.Value)

	// Back to the identifier, then "Sign up" — the purposed navigation.
	back := mustSubmitOK(t, client, flowID, zflow, "back", nil)
	require.Equal(t, "identifier", back.Response.Step.Name)
	zflow = mustExtractZflow(t, back.SetCookie.Value)

	toRegister := mustSubmitOK(t, client, flowID, zflow, "register", nil)
	require.Equal(t, "register-identifier", toRegister.Response.Step.Name)
	zflow = mustExtractZflow(t, toRegister.SetCookie.Value)

	// Cookie-size bound: toggling Sign in / Sign up is an undo, not a push.
	// The encrypted value length must not grow across toggles.
	baseline := len(zflow)
	for i := 0; i < 10; i++ {
		action := "sign_in"
		if i%2 == 1 {
			action = "register"
		}
		toggled := mustSubmitOK(t, client, flowID, zflow, action, nil)
		zflow = mustExtractZflow(t, toggled.SetCookie.Value)
		require.LessOrEqual(t, len(zflow), baseline+64,
			"toggle %d: purpose toggling must not grow the state cookie", i)
	}
	// The loop ends on register-identifier (even toggle count).

	// Re-identifying the existing email in register mode must route
	// user_already_exists → password on the rotated attempt — not die with
	// "The user was already authenticated".
	guarded := mustSubmitOK(t, client, flowID, zflow, "submit", api.FlowSubmitRequestFields{
		"email": jx.Raw(`"` + email + `"`),
	})
	require.Equal(t, "password", guarded.Response.Step.Name,
		"existing email after re-purpose must reach password verification")
	zflow = mustExtractZflow(t, guarded.SetCookie.Value)

	// And the rotated attempt verifies the password end to end.
	done := mustSubmitOK(t, client, flowID, zflow, "submit", api.FlowSubmitRequestFields{
		"x-auth-methods#password": jx.Raw(`"` + password + `"`),
	})
	require.Equal(t, "done", done.Response.Step.Name)
}

// TestBackToIdentifierRotatesAuthAttempt drives the back action through the
// real HTTP service and auth-attempt domain. Identifying pins the user as a
// factor on the attempt, and PrepareUserChallenge refuses a second user
// challenge on a session-linked attempt — which every flow is, since the flow
// service links the attempt to the session it runs against. Going back to the
// identifier and submitting again must therefore land on a rotated attempt;
// without the rotation this path dies with "The user was already
// authenticated".
//
// The state-machine unit test
// (TestFlowStateMachine_Back_ToIdentifierRotatesAuthAttempt) covers the
// rotation itself against a mocked attempt service; only here does the real
// guard run.
func TestBackToIdentifierRotatesAuthAttempt(t *testing.T) {
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)

	server := harness.EnsureTestServer(t)
	client, err := helpers.NewApiClient(server.URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	defResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID:      api.ProjectID(project.ID),
		FlowDefinition: purposeNavFlowDefinition(schemaURL),
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, defResp, "create flow definition: %s", helpers.MustMarshal(t, defResp))

	const (
		email    = "back-to-identifier@example.com"
		password = "very-good-password-1"
	)

	// Seed the existing user through a registration flow.
	regResp, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{
		ProjectID: api.ProjectID(project.ID),
		Purpose:   api.CreateFlowRequestPurposeRegister,
	})
	require.NoError(t, err)
	regHeaders := regResp.(*api.FlowResponseHeaders)
	regID := regHeaders.Response.ID
	regZflow := mustExtractZflow(t, regHeaders.SetCookie.Value)

	regIDResp := mustSubmitOK(t, client, regID, regZflow, "submit", api.FlowSubmitRequestFields{
		"email": jx.Raw(`"` + email + `"`),
	})
	require.Equal(t, "register-password", regIDResp.Response.Step.Name)
	regZflow = mustExtractZflow(t, regIDResp.SetCookie.Value)

	regDone := mustSubmitOK(t, client, regID, regZflow, "submit", api.FlowSubmitRequestFields{
		"x-auth-methods#password": jx.Raw(`"` + password + `"`),
	})
	require.Equal(t, "done", regDone.Response.Step.Name)

	// Login flow: resolve the existing user onto the attempt.
	loginResp, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{
		ProjectID: api.ProjectID(project.ID),
		Purpose:   api.CreateFlowRequestPurposeLogin,
	})
	require.NoError(t, err)
	loginHeaders := loginResp.(*api.FlowResponseHeaders)
	flowID := loginHeaders.Response.ID
	require.Equal(t, "identifier", loginHeaders.Response.Step.Name)
	zflow := mustExtractZflow(t, loginHeaders.SetCookie.Value)

	identified := mustSubmitOK(t, client, flowID, zflow, "submit", api.FlowSubmitRequestFields{
		"email": jx.Raw(`"` + email + `"`),
	})
	require.Equal(t, "password", identified.Response.Step.Name)
	zflow = mustExtractZflow(t, identified.SetCookie.Value)

	// Back to the identifier — no purpose switch, just the back action.
	back := mustSubmitOK(t, client, flowID, zflow, "back", nil)
	require.Equal(t, "identifier", back.Response.Step.Name)
	zflow = mustExtractZflow(t, back.SetCookie.Value)

	// Re-identifying must reach password verification on the rotated
	// attempt, not die with "The user was already authenticated".
	reIdentified := mustSubmitOK(t, client, flowID, zflow, "submit", api.FlowSubmitRequestFields{
		"email": jx.Raw(`"` + email + `"`),
	})
	require.Equal(t, "password", reIdentified.Response.Step.Name,
		"re-identifying after back must reach password verification")
	zflow = mustExtractZflow(t, reIdentified.SetCookie.Value)

	// And the rotated attempt verifies the password end to end.
	done := mustSubmitOK(t, client, flowID, zflow, "submit", api.FlowSubmitRequestFields{
		"x-auth-methods#password": jx.Raw(`"` + password + `"`),
	})
	require.Equal(t, "done", done.Response.Step.Name)
	handoffToken, hasToken := done.Response.HandoffToken.Get()
	require.True(t, hasToken, "sign-in on the rotated attempt must issue a handoff token")
	require.NotEmpty(t, handoffToken)
}

// mustSubmitOK submits a flow action and requires a non-error step response.
func mustSubmitOK(t *testing.T, client *helpers.ApiClient, flowID, zflow, action string, fields api.FlowSubmitRequestFields) *api.SubmitFlowStepOK {
	t.Helper()
	req := &api.FlowSubmitRequest{Action: action}
	if fields != nil {
		req.Fields = api.NewOptFlowSubmitRequestFields(fields)
	}
	resp, err := client.SubmitFlowStep(t.Context(), req, api.SubmitFlowStepParams{
		ID:    flowID,
		Zflow: zflow,
	})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, resp, helpers.MustMarshal(t, resp))
	ok := resp.(*api.SubmitFlowStepOK)
	require.False(t, ok.Response.Step.Error.Set, "step error: %s", helpers.MustMarshal(t, resp))
	return ok
}

// purposeNavFlowDefinition is combinedPasswordFlowDefinition with the
// shipped default's shape: navigate-kind purpose-switch actions whose
// transitions declare a local purpose.
func purposeNavFlowDefinition(userSchema string) api.FlowDefinition {
	createUser := api.FlowDefinitionStepOnSuccessCreateUser
	registerPurpose := api.NewOptNilFlowDefinitionStepTransitionsItemPurpose(api.FlowDefinitionStepTransitionsItemPurposeRegister)
	loginPurpose := api.NewOptNilFlowDefinitionStepTransitionsItemPurpose(api.FlowDefinitionStepTransitionsItemPurposeLogin)
	return api.FlowDefinition{
		Name:       "purpose-nav-password",
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
					{Name: "register", Kind: api.StepActionKindNavigate},
				},
				Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
					"submit":         api.FlowDefinitionStepTransitionsItem{Target: "password"},
					"register":       api.FlowDefinitionStepTransitionsItem{Target: "register-identifier", Purpose: registerPurpose},
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
					{Name: "sign_in", Kind: api.StepActionKindNavigate},
				},
				Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
					"submit":              api.FlowDefinitionStepTransitionsItem{Target: "register-password"},
					"sign_in":             api.FlowDefinitionStepTransitionsItem{Target: "identifier", Purpose: loginPurpose},
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
