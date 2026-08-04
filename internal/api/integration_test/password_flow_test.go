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
	"github.com/zitadel/nextgen/internal/service"
)

// TestPasswordLoginFlow exercises the example 01 (password-login) JSON
// definition end-to-end over the real /flow REST API: start flow → submit
// identifier step → submit password step → assert handoff token.
//
// The passkey flows have HTTP e2e coverage (passkey_flow_test.go,
// registration_flow_test.go); this test gives the password path the same
// shape so neither the dispatch nor the password challenge can regress
// behind the unit suite.
func TestPasswordLoginFlow(t *testing.T) {
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: project.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)

	schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)

	const (
		userID    = "pwlogin-user-01"
		userEmail = "pwlogin@example.com"
		userPass  = "correct-horse-battery-staple"
	)

	emailAttr, err := domain.NewCreateAttribute("email", userEmail, domain.AttributeUniquenessProject)
	require.NoError(t, err)

	users := harness.EnsureUserFixture(t)
	require.NoError(t, users.Create(t.Context(), &domain.CreateUser{
		ProjectID:               project.ID,
		SchemaURL:               schemaURL,
		ID:                      userID,
		InitialMembershipTeamID: &team.ID,
		Attributes:              domain.CreateAttributes{*emailAttr},
	}))

	hasher := harness.EnsureHasher(t)
	encodedHash, err := hasher.Hash(userPass)
	require.NoError(t, err)

	require.NoError(t, harness.EnsureUserFixture(t).SetPassword(t.Context(), &domain.SetUserPassword{
		ProjectID:   project.ID,
		UserID:      userID,
		EncodedHash: encodedHash,
	}))

	server := harness.EnsureTestServer(t)
	client, err := helpers.NewApiClient(server.URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	defResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID:      api.ProjectID(project.ID),
		FlowDefinition: passwordLoginFlowDefinition(schemaURL),
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

	// Step 1: submit identifier → password step.
	idResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "submit",
		Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{
			"email": jx.Raw(`"` + userEmail + `"`),
		}),
	}, api.SubmitFlowStepParams{
		ID:    flowID,
		Zflow: zflow,
	})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, idResp, helpers.MustMarshal(t, idResp))
	idOK := idResp.(*api.SubmitFlowStepOK)
	require.Equal(t, "password", idOK.Response.Step.Name)
	zflow = mustExtractZflow(t, idOK.SetCookie.Value)

	// Step 2: submit password → done + handoff token.
	pwResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "submit",
		Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{
			"x-auth-methods#password": jx.Raw(`"` + userPass + `"`),
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
	require.True(t, hasToken, "expected handoff token after successful password login")
	require.NotEmpty(t, handoffToken)
}

// TestPasswordLoginFlow_UnknownEmail confirms an unknown identifier routes to
// the `user_not_found` outcome without ever attempting password verification.
func TestPasswordLoginFlow_UnknownEmail(t *testing.T) {
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)

	server := harness.EnsureTestServer(t)
	client, err := helpers.NewApiClient(server.URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	defResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID:      api.ProjectID(project.ID),
		FlowDefinition: passwordLoginFlowWithNotFoundFlowDefinition(schemaURL),
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
	zflow := mustExtractZflow(t, flowHeaders.SetCookie.Value)

	idResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "submit",
		Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{
			"email": jx.Raw(`"ghost-pwlogin@example.com"`),
		}),
	}, api.SubmitFlowStepParams{
		ID:    flowID,
		Zflow: zflow,
	})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, idResp, helpers.MustMarshal(t, idResp))
	idOK := idResp.(*api.SubmitFlowStepOK)
	require.Equal(t, "not_found", idOK.Response.Step.Name, "user_not_found must route to not_found terminal")
	require.True(t, idOK.Response.Step.Complete.Set, "expected terminal step")

	_, hasToken := idOK.Response.HandoffToken.Get()
	require.False(t, hasToken, "informational terminal must not issue a handoff token")
}

// TestPasswordRegisterFlow exercises example 02 (password-register): a single
// signup step collecting email+password with on_success: create_user. Verifies
// the user + password row land in the database and a handoff token is issued
// so the new user is auto-signed-in.
func TestPasswordRegisterFlow(t *testing.T) {
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)

	server := harness.EnsureTestServer(t)
	client, err := helpers.NewApiClient(server.URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	defResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID:      api.ProjectID(project.ID),
		FlowDefinition: passwordRegisterFlowDefinition(schemaURL),
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionDetailResponse{}, defResp, "create flow definition: %s", helpers.MustMarshal(t, defResp))

	createResp, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{
		ProjectID: api.ProjectID(project.ID),
		Purpose:   api.CreateFlowRequestPurposeRegister,
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowResponseHeaders{}, createResp, helpers.MustMarshal(t, createResp))
	flowHeaders := createResp.(*api.FlowResponseHeaders)
	flowID := flowHeaders.Response.ID
	require.Equal(t, "signup", flowHeaders.Response.Step.Name)
	zflow := mustExtractZflow(t, flowHeaders.SetCookie.Value)

	const (
		newEmail = "pwregister@example.com"
		newPass  = "super-secret-password-1"
	)

	submitResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "submit",
		Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{
			"email":                   jx.Raw(`"` + newEmail + `"`),
			"x-auth-methods#password": jx.Raw(`"` + newPass + `"`),
		}),
	}, api.SubmitFlowStepParams{
		ID:    flowID,
		Zflow: zflow,
	})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, submitResp, helpers.MustMarshal(t, submitResp))
	submitOK := submitResp.(*api.SubmitFlowStepOK)
	require.Equal(t, "done", submitOK.Response.Step.Name)
	require.True(t, submitOK.Response.Step.Complete.Set, "expected terminal step")

	handoffToken, hasToken := submitOK.Response.HandoffToken.Get()
	require.True(t, hasToken, "create_user must issue handoff token on terminal")
	require.NotEmpty(t, handoffToken)

	// User row exists with the submitted email.
	users := harness.EnsureUserFixture(t)
	user, err := users.GetByAttributes(t.Context(), project.ID, []domain.Attribute{{Key: "email", Value: newEmail}})
	require.NoError(t, err, "create_user must persist exactly one user")

	// Password hash exists for that user and verifies the submitted password.
	pw, err := harness.EnsureUserFixture(t).GetPasswordByUserID(t.Context(), project.ID, user.ID)
	require.NoError(t, err)
	require.NotEmpty(t, pw.EncodedHash)
	require.NoError(t, pw.Verify(newPass, harness.EnsureHashVerifier(t)))
}

// TestPasswordRegisterFlow_DuplicateEmail confirms a second registration with
// the same email surfaces user_already_exists via the create_user writer
// (UniqueError → StepError handled by the flow engine).
func TestPasswordRegisterFlow_DuplicateEmail(t *testing.T) {
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)

	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: project.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)

	// Pre-seed a user with the email we'll try to register.
	const conflictEmail = "pwregister-conflict@example.com"
	emailAttr, err := domain.NewCreateAttribute("email", conflictEmail, domain.AttributeUniquenessProject)
	require.NoError(t, err)
	require.NoError(t, harness.EnsureUserFixture(t).Create(t.Context(), &domain.CreateUser{
		ProjectID:               project.ID,
		SchemaURL:               schemaURL,
		ID:                      "pwregister-conflict-seed",
		InitialMembershipTeamID: &team.ID,
		Attributes:              domain.CreateAttributes{*emailAttr},
	}))

	server := harness.EnsureTestServer(t)
	client, err := helpers.NewApiClient(server.URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	defResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID:      api.ProjectID(project.ID),
		FlowDefinition: passwordRegisterFlowDefinition(schemaURL),
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionDetailResponse{}, defResp)

	createResp, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{
		ProjectID: api.ProjectID(project.ID),
		Purpose:   api.CreateFlowRequestPurposeRegister,
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowResponseHeaders{}, createResp, helpers.MustMarshal(t, createResp))
	flowHeaders := createResp.(*api.FlowResponseHeaders)
	flowID := flowHeaders.Response.ID
	zflow := mustExtractZflow(t, flowHeaders.SetCookie.Value)

	submitResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "submit",
		Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{
			"email":                   jx.Raw(`"` + conflictEmail + `"`),
			"x-auth-methods#password": jx.Raw(`"some-strong-password"`),
		}),
	}, api.SubmitFlowStepParams{
		ID:    flowID,
		Zflow: zflow,
	})
	require.NoError(t, err)
	// Without a user_already_exists transition the engine surfaces the error
	// on the same step and the HTTP layer maps it to 400.
	require.IsType(t, &api.SubmitFlowStepBadRequest{}, submitResp, helpers.MustMarshal(t, submitResp))
	badResp := submitResp.(*api.SubmitFlowStepBadRequest)
	require.Equal(t, "signup", badResp.Response.Step.Name, "duplicate email must keep flow on signup step")
	errVal, errSet := badResp.Response.Step.Error.Get()
	require.True(t, errSet, "expected an error on the step")
	require.Equal(t, "user_already_exists", errVal)
	require.False(t, badResp.Response.Step.Complete.Set, "expected non-terminal step")
	_, hasToken := badResp.Response.HandoffToken.Get()
	require.False(t, hasToken, "no handoff token on rejected registration")
}

// passwordLoginFlowDefinition mirrors examples/01-password-login.
func passwordLoginFlowDefinition(userSchemaURL string) api.FlowDefinition {
	return api.FlowDefinition{
		Name:       "password-login",
		Status:     "active",
		UserSchema: userSchemaURL,
		Purposes:   api.FlowDefinitionPurposes{"login": "identifier"},
		Steps: []api.FlowDefinitionStep{
			{
				Name:   "identifier",
				Fields: []string{"email"},
				Actions: []api.StepAction{
					{Name: "submit", Kind: api.StepActionKindSubmit, Primary: api.NewOptBool(true)},
				},
				Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
					"submit": api.FlowDefinitionStepTransitionsItem{Target: "password"},
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
				Name:     "done",
				Complete: api.NewOptFlowDefinitionStepComplete(api.FlowDefinitionStepCompleteShow),
			},
		},
	}
}

// passwordRegisterFlowDefinition mirrors examples/02-password-register.
func passwordRegisterFlowDefinition(userSchemaURL string) api.FlowDefinition {
	createUser := api.FlowDefinitionStepOnSuccessCreateUser
	return api.FlowDefinition{
		Name:       "password-register",
		UserSchema: userSchemaURL,
		Status:     "active",
		Purposes:   api.FlowDefinitionPurposes{"register": "signup"},
		Steps: []api.FlowDefinitionStep{
			{
				Name:      "signup",
				Fields:    []string{"email", "x-auth-methods#password"},
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

// passwordLoginFlowWithNotFoundFlowDefinition adds a user_not_found outcome
// pointing to a `not_found` terminal so the unknown-email path is observable.
func passwordLoginFlowWithNotFoundFlowDefinition(userSchemaURL string) api.FlowDefinition {
	return api.FlowDefinition{
		Name:       "password-login-with-not-found",
		UserSchema: userSchemaURL,
		Status:     "active",
		Purposes:   api.FlowDefinitionPurposes{"login": "identifier"},
		Steps: []api.FlowDefinitionStep{
			{
				Name:   "identifier",
				Fields: []string{"email"},
				Actions: []api.StepAction{
					{Name: "submit", Kind: api.StepActionKindSubmit, Primary: api.NewOptBool(true)},
				},
				Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
					"submit":         api.FlowDefinitionStepTransitionsItem{Target: "password"},
					"user_not_found": api.FlowDefinitionStepTransitionsItem{Target: "not_found"},
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
				Name:     "done",
				Complete: api.NewOptFlowDefinitionStepComplete(api.FlowDefinitionStepCompleteShow),
			},
			{
				Name:     "not_found",
				Complete: api.NewOptFlowDefinitionStepComplete(api.FlowDefinitionStepCompleteShow),
			},
		},
	}
}
