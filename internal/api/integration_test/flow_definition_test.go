//go:build postgres_integration || spanner_integration

package integration_test

import (
	"net/http"
	"net/url"
	"testing"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
)

func TestCreateFlowDefinitionUnauthenticated(t *testing.T) {
	t.Parallel()

	userSchema := "https://some-tenant.com/schemas/unknown-user-schema.yaml"
	userSchemaURI, err := url.Parse(userSchema)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)

	resp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID: "proj_1234",
		FlowDefinition: api.FlowDefinition{
			Name:       "login-flow",
			Status:     "active",
			UserSchema: *userSchemaURI,
			Purposes:   map[string]string{"login": "step_1"},
			Audience: api.OptFlowAudience{
				Value: api.FlowAudience{
					TeamIds: []string{"team-1", "team-2"},
					AppIds:  []string{"app-1", "app-2"},
				},
			},
			Steps: validSteps(),
		},
	})
	expectedResp := &api.ErrorDetailsStatusCode{
		StatusCode: http.StatusUnauthorized,
		Response: api.ErrorDetails{
			Code:    "auth.unauthorized",
			Message: `operation CreateFlowDefinition: security "": security requirement is not satisfied`,
		},
	}
	require.NoError(t, err)
	assert.Equal(t, expectedResp, resp)
}

func TestCreateFlowDefinition(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
	require.NoError(t, err)
	harness.CreateUserSchema(t, project, harness.TestData.Schemas.CreateSchemaRequestUserSchema)

	u := "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml"
	userSchemaURI, err := url.Parse(u)
	require.NoError(t, err)

	unknownUserSchema := "https://some-tenant.com/schemas/unknown-user-schema.yaml"
	unknownUserSchemaURI, err := url.Parse(unknownUserSchema)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	client.SetToken(project.ProjectSecret)

	_, err = client.CreateFlowDefinition(
		t.Context(),
		newCreateFlowDefinitionRequest(api.ProjectID(project.ID), newFlowDefinitionFixture("existing-flow", *userSchemaURI)),
	)
	require.NoError(t, err)

	tests := []struct {
		name     string
		req      *api.CreateFlowDefinitionRequest
		wantResp api.CreateFlowDefinitionRes
	}{
		{
			name: "flow definition created successfully",
			req:  newCreateFlowDefinitionRequest(api.ProjectID(project.ID), newFlowDefinitionFixture("login-flow", *userSchemaURI)),
			wantResp: &api.FlowDefinitionDetailResponse{
				ProjectID: project.ID,
				FlowDefinition: api.FlowDefinition{
					Name:       "login-flow",
					UserSchema: *userSchemaURI,
					Purposes:   map[string]string{"login": "step_1"},
					Audience: api.OptFlowAudience{
						Value: api.FlowAudience{
							TeamIds: []string{"team-1", "team-2"},
							AppIds:  []string{"app-1", "app-2"},
						},
						Set: true,
					},
					Steps:  validSteps(),
					Status: api.FlowDefinitionStatusActive,
				},
			},
		},
		{
			name: "unknown user schema",
			req:  newCreateFlowDefinitionRequest(api.ProjectID(project.ID), newFlowDefinitionFixture("login-flow-2", *unknownUserSchemaURI)),
			wantResp: &api.CreateFlowDefinitionBadRequest{
				Code:    "flowdef.invalid",
				Message: "flow definition: invalid",
				Details: api.OptErrorDetailsDetails{
					Value: api.ErrorDetailsDetails{
						"details": jx.Raw(`"user schema \"https://some-tenant.com/schemas/unknown-user-schema.yaml\" not found"`),
					},
					Set: true,
				},
			},
		},
		{
			name: "already existing flow definition",
			req:  newCreateFlowDefinitionRequest(api.ProjectID(project.ID), newFlowDefinitionFixture("existing-flow", *userSchemaURI)),
			wantResp: &api.CreateFlowDefinitionConflict{
				Code:    "flowdef.already_exists",
				Message: "flow definition: already exists",
			},
		},
		{
			name: "invalid flow definition - entry step unknown",
			req: &api.CreateFlowDefinitionRequest{
				ProjectID: api.ProjectID(project.ID),
				FlowDefinition: api.FlowDefinition{
					Name:       "invalid-flow",
					Status:     "active",
					UserSchema: *userSchemaURI,
					Purposes:   map[string]string{"login": "collect_identifier"},
					Audience: api.OptFlowAudience{
						Value: api.FlowAudience{
							TeamIds: []string{"team-1", "team-2"},
							AppIds:  []string{"app-1", "app-2"},
						},
						Set: true,
					},
					Steps: []api.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []string{"email"},
							Transitions: api.NewOptFlowDefinitionStepTransitions(map[string]api.FlowDefinitionStepTransitionsItem{
								"submit": {
									Target: "step_2",
								},
							}),
							Actions: []api.StepAction{
								{Name: "submit", Kind: api.StepActionKindSubmit, Primary: api.NewOptBool(true)},
							},
						},
						{
							Name:     "step_2",
							Complete: api.NewOptFlowDefinitionStepComplete(api.FlowDefinitionStepCompleteRedirect),
						},
					},
				},
			},
			wantResp: &api.CreateFlowDefinitionBadRequest{
				Code:    "flowdef.invalid",
				Message: "flow definition: invalid",
				Details: api.OptErrorDetailsDetails{
					Value: api.ErrorDetailsDetails{
						"details": jx.Raw(`"purpose \"login\" targets unknown entry-point step \"collect_identifier\""`),
					},
					Set: true,
				},
			},
		},
		{
			name: "invalid flow definition - user fields not defined in user schema",
			req: &api.CreateFlowDefinitionRequest{
				ProjectID: api.ProjectID(project.ID),
				FlowDefinition: api.FlowDefinition{
					Name:       "invalid-flow",
					UserSchema: *userSchemaURI,
					Status:     "active",
					Purposes:   map[string]string{"login": "step_1"},
					Audience: api.OptFlowAudience{
						Value: api.FlowAudience{
							TeamIds: []string{"team-1", "team-2"},
							AppIds:  []string{"app-1", "app-2"},
						},
						Set: true,
					},
					Steps: []api.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []string{"email", "username"},
							Transitions: api.NewOptFlowDefinitionStepTransitions(map[string]api.FlowDefinitionStepTransitionsItem{
								"submit": {
									Target: "step_2",
								},
							}),
							Actions: []api.StepAction{
								{Name: "submit", Kind: api.StepActionKindSubmit, Primary: api.NewOptBool(true)},
							},
						},
						{
							Name:     "step_2",
							Complete: api.NewOptFlowDefinitionStepComplete(api.FlowDefinitionStepCompleteRedirect),
						},
					},
				},
			},
			wantResp: &api.CreateFlowDefinitionBadRequest{
				Code:    "flowdef.invalid",
				Message: "flow definition: invalid",
				Details: api.OptErrorDetailsDetails{
					Value: api.ErrorDetailsDetails{
						"details": jx.Raw(`"step \"step_1\": flow field: not a property in the user schema: \"username\""`),
					},
					Set: true,
				},
			},
		},
		{
			name: "invalid flow definition - missing required fields per user schema",
			req: &api.CreateFlowDefinitionRequest{
				ProjectID: api.ProjectID(project.ID),
				FlowDefinition: api.FlowDefinition{
					Name:       "invalid-flow",
					UserSchema: *userSchemaURI,
					Purposes:   map[string]string{"login": "step_1"},
					Audience: api.OptFlowAudience{
						Value: api.FlowAudience{
							TeamIds: []string{"team-1", "team-2"},
							AppIds:  []string{"app-1", "app-2"},
						},
						Set: true,
					},
					Steps: []api.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []string{"username"},
							Transitions: api.NewOptFlowDefinitionStepTransitions(map[string]api.FlowDefinitionStepTransitionsItem{
								"submit": {
									Target: "step_2",
								},
							}),
							Actions: []api.StepAction{
								{Name: "submit", Kind: api.StepActionKindSubmit, Primary: api.NewOptBool(true)},
							},
						},
						{
							Name:     "step_2",
							Complete: api.NewOptFlowDefinitionStepComplete(api.FlowDefinitionStepCompleteRedirect),
						},
					},
				},
			},
			wantResp: &api.CreateFlowDefinitionBadRequest{
				Code:    "flowdef.invalid",
				Message: "flow definition: invalid",
				Details: api.OptErrorDetailsDetails{
					Value: api.ErrorDetailsDetails{
						"details": jx.Raw(`"required fields [email] in user schema are missing in the flow definition steps"`),
					},
					Set: true,
				},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			resp, err := client.CreateFlowDefinition(t.Context(), tt.req)
			assert.NoError(t, err)
			assertFlowDefinitionResponse(t, tt.wantResp, resp)
		})
	}
}

func TestUpdateFlowDefinitionUnauthenticated(t *testing.T) {
	t.Parallel()

	userSchema := "https://some-tenant.com/schemas/unknown-user-schema.yaml"
	userSchemaURI, err := url.Parse(userSchema)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)

	resp, err := client.UpdateFlowDefinition(t.Context(), &api.FlowDefinitionUpdateRequest{
		FlowDefinition: api.FlowDefinition{
			Name:       "login-flow",
			Status:     "active",
			UserSchema: *userSchemaURI,
			Purposes:   map[string]string{"login": "step_1"},
			Steps:      validSteps(),
		},
	}, api.UpdateFlowDefinitionParams{
		ID:        "flowDef_1234",
		ProjectID: "proj_1234",
	})
	require.NoError(t, err)
	assert.Equal(t, &api.ErrorDetailsStatusCode{
		StatusCode: http.StatusUnauthorized,
		Response: api.ErrorDetails{
			Code:    "auth.unauthorized",
			Message: `operation UpdateFlowDefinition: security "": security requirement is not satisfied`,
		},
	}, resp)
}

func TestUpdateFlowDefinition(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
	require.NoError(t, err)
	harness.CreateUserSchema(t, project, harness.TestData.Schemas.CreateSchemaRequestUserSchema)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	client.SetToken(project.ProjectSecret)

	u := "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml"
	userSchemaURI, err := url.Parse(u)
	require.NoError(t, err)

	unknownUserSchema := "https://some-tenant.com/schemas/unknown-user-schema.yaml"
	unknownUserSchemaURI, err := url.Parse(unknownUserSchema)
	require.NoError(t, err)

	createResp, err := client.CreateFlowDefinition(
		t.Context(),
		newCreateFlowDefinitionRequest(api.ProjectID(project.ID), newFlowDefinitionFixture("login-flow", *userSchemaURI)),
	)
	require.NoError(t, err)
	loginFlowDef, ok := createResp.(*api.FlowDefinitionDetailResponse)
	require.True(t, ok)

	multiPurposeResp, err := client.CreateFlowDefinition(
		t.Context(),
		newCreateFlowDefinitionRequest(api.ProjectID(project.ID), func() api.FlowDefinition {
			def := newFlowDefinitionFixture("multi-purpose-flow", *userSchemaURI)
			def.Purposes = map[string]string{
				"login":    "step_1",
				"recovery": "step_1",
			}
			return def
		}()),
	)
	require.NoError(t, err)
	loginRegisterFlowDef, ok := multiPurposeResp.(*api.FlowDefinitionDetailResponse)
	require.True(t, ok)

	tests := []struct {
		name     string
		req      *api.FlowDefinitionUpdateRequest
		params   api.UpdateFlowDefinitionParams
		wantResp api.UpdateFlowDefinitionRes
	}{
		{
			name: "flow definition updated successfully",
			req: newUpdateFlowDefinitionRequest(func() api.FlowDefinition {
				def := newFlowDefinitionFixture("updated-flow", *userSchemaURI)
				def.Audience = api.OptFlowAudience{
					Value: api.FlowAudience{TeamIds: []string{"team-2"}, AppIds: []string{"app-2"}},
					Set:   true,
				}
				return def
			}()),
			params: api.UpdateFlowDefinitionParams{ProjectID: api.ProjectID(project.ID), ID: loginFlowDef.ID},
			wantResp: &api.FlowDefinitionDetailResponse{
				ID:        loginFlowDef.ID,
				ProjectID: project.ID,
				FlowDefinition: api.FlowDefinition{
					Name:       "updated-flow",
					UserSchema: *userSchemaURI,
					Purposes:   map[string]string{"login": "step_1"},
					Audience: api.OptFlowAudience{
						Value: api.FlowAudience{TeamIds: []string{"team-2"}, AppIds: []string{"app-2"}},
						Set:   true,
					},
					Steps:  validSteps(),
					Status: api.FlowDefinitionStatusActive,
				},
			},
		},
		{
			name: "deactivate while removing old purpose fails when removed purpose has no alternate active definition",
			req: newUpdateFlowDefinitionRequest(func() api.FlowDefinition {
				def := newFlowDefinitionFixture("multi-purpose-flow-updated", *userSchemaURI)
				def.Purposes = map[string]string{
					"login": "step_1", // remove recovery
				}
				def.Status = api.FlowDefinitionStatusDraft // deactivate while removing recovery
				return def
			}()),
			params: api.UpdateFlowDefinitionParams{ProjectID: api.ProjectID(project.ID), ID: loginRegisterFlowDef.ID},
			wantResp: &api.ErrorDetailsStatusCode{
				StatusCode: http.StatusConflict,
				Response: api.ErrorDetails{
					Code:    "flowdef.update_conflict",
					Message: "flow definition: update conflict",
					Details: api.OptErrorDetailsDetails{
						Value: api.ErrorDetailsDetails{
							"details": jx.Raw(`"cannot update: no other active flow definition found with purpose \"recovery\""`),
						},
						Set: true,
					},
				},
			},
		},
		{
			name: "active update removing old purpose fails when removed purpose has no alternate active definition",
			req: newUpdateFlowDefinitionRequest(func() api.FlowDefinition {
				def := newFlowDefinitionFixture("multi-purpose-flow-remove-recovery", *userSchemaURI)
				def.Purposes = map[string]string{
					"login": "step_1", // remove recovery while staying active
				}
				def.Status = api.FlowDefinitionStatusActive
				return def
			}()),
			params: api.UpdateFlowDefinitionParams{ProjectID: api.ProjectID(project.ID), ID: loginRegisterFlowDef.ID},
			wantResp: &api.ErrorDetailsStatusCode{
				StatusCode: http.StatusConflict,
				Response: api.ErrorDetails{
					Code:    "flowdef.update_conflict",
					Message: "flow definition: update conflict",
					Details: api.OptErrorDetailsDetails{
						Value: api.ErrorDetailsDetails{
							"details": jx.Raw(`"cannot update: no other active flow definition found with purpose \"recovery\""`),
						},
						Set: true,
					},
				},
			},
		},
		{
			name: "active update removing purpose succeeds when alternate active definition exists",
			req: newUpdateFlowDefinitionRequest(func() api.FlowDefinition {
				def := newFlowDefinitionFixture("multi-purpose-flow-remove-login", *userSchemaURI)
				def.Purposes = map[string]string{
					"recovery": "step_1", // remove login
				}
				def.Status = api.FlowDefinitionStatusActive
				return def
			}()),
			params: api.UpdateFlowDefinitionParams{ProjectID: api.ProjectID(project.ID), ID: loginRegisterFlowDef.ID},
			wantResp: &api.FlowDefinitionDetailResponse{
				ID:        loginRegisterFlowDef.ID,
				ProjectID: project.ID,
				FlowDefinition: api.FlowDefinition{
					Name:       "multi-purpose-flow-remove-login",
					UserSchema: *userSchemaURI,
					Purposes:   map[string]string{"recovery": "step_1"},
					Audience: api.OptFlowAudience{
						Value: api.FlowAudience{
							TeamIds: []string{"team-1", "team-2"},
							AppIds:  []string{"app-1", "app-2"},
						},
						Set: true,
					},
					Steps:  validSteps(),
					Status: api.FlowDefinitionStatusActive,
				},
			},
		},
		{
			name:   "flow definition not found",
			req:    newUpdateFlowDefinitionRequest(newFlowDefinitionFixture("updated-flow", *userSchemaURI)),
			params: api.UpdateFlowDefinitionParams{ProjectID: api.ProjectID(project.ID), ID: "flowdef_missing"},
			wantResp: &api.UpdateFlowDefinitionNotFound{
				Code:    "flowdef.not_found",
				Message: "flow definition: not found",
			},
		},
		{
			name:   "unknown user schema",
			req:    newUpdateFlowDefinitionRequest(newFlowDefinitionFixture("updated-flow", *unknownUserSchemaURI)),
			params: api.UpdateFlowDefinitionParams{ProjectID: api.ProjectID(project.ID), ID: loginFlowDef.ID},
			wantResp: &api.UpdateFlowDefinitionBadRequest{
				Code:    "flowdef.invalid",
				Message: "flow definition: invalid",
				Details: api.OptErrorDetailsDetails{
					Value: api.ErrorDetailsDetails{
						"details": jx.Raw(`"user schema \"https://some-tenant.com/schemas/unknown-user-schema.yaml\" not found"`),
					},
					Set: true,
				},
			},
		},
		{
			name: "invalid flow definition",
			req: newUpdateFlowDefinitionRequest(func() api.FlowDefinition {
				def := newFlowDefinitionFixture("updated-flow", *userSchemaURI)
				def.Purposes = map[string]string{"login": "collect_identifier"}
				return def
			}()),
			params: api.UpdateFlowDefinitionParams{ProjectID: api.ProjectID(project.ID), ID: loginFlowDef.ID},
			wantResp: &api.UpdateFlowDefinitionBadRequest{
				Code:    "flowdef.invalid",
				Message: "flow definition: invalid",
				Details: api.OptErrorDetailsDetails{
					Value: api.ErrorDetailsDetails{
						"details": jx.Raw(`"purpose \"login\" targets unknown entry-point step \"collect_identifier\""`),
					},
					Set: true,
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			resp, err := client.UpdateFlowDefinition(t.Context(), tt.req, tt.params)
			assert.NoError(t, err)
			assertFlowDefinitionResponse(t, tt.wantResp, resp)
		})
	}
}

func newCreateFlowDefinitionRequest(projectID api.ProjectID, definition api.FlowDefinition) *api.CreateFlowDefinitionRequest {
	return &api.CreateFlowDefinitionRequest{
		ProjectID:      projectID,
		FlowDefinition: definition,
	}
}

func newUpdateFlowDefinitionRequest(definition api.FlowDefinition) *api.FlowDefinitionUpdateRequest {
	return &api.FlowDefinitionUpdateRequest{FlowDefinition: definition}
}

func newFlowDefinitionFixture(name string, userSchemaURI url.URL) api.FlowDefinition {
	return api.FlowDefinition{
		Name:       name,
		Status:     "active",
		UserSchema: userSchemaURI,
		Purposes:   map[string]string{"login": "step_1"},
		Audience: api.OptFlowAudience{
			Value: api.FlowAudience{
				TeamIds: []string{"team-1", "team-2"},
				AppIds:  []string{"app-1", "app-2"},
			},
			Set: true,
		},
		Steps: validSteps(),
	}
}

func assertFlowDefinitionResponse(t *testing.T, want, got any) {
	t.Helper()
	switch want.(type) {
	case *api.FlowDefinitionDetailResponse:
		expected, ok := want.(*api.FlowDefinitionDetailResponse)
		require.True(t, ok)
		actual, ok := got.(*api.FlowDefinitionDetailResponse)
		require.True(t, ok)

		assert.NotEmpty(t, actual.ID)
		assert.Equal(t, expected.ProjectID, actual.ProjectID)
		assert.Equal(t, expected.FlowDefinition, actual.FlowDefinition)
	case *api.CreateFlowDefinitionBadRequest:
		expected, ok := want.(*api.CreateFlowDefinitionBadRequest)
		require.True(t, ok)
		actual, ok := got.(*api.CreateFlowDefinitionBadRequest)
		require.True(t, ok)

		assert.Equal(t, expected.Code, actual.Code)
		assert.Equal(t, expected.Message, actual.Message)
		assert.Equal(t, expected.Details, actual.Details)
	case *api.CreateFlowDefinitionConflict:
		expected, ok := want.(*api.CreateFlowDefinitionConflict)
		require.True(t, ok)
		actual, ok := got.(*api.CreateFlowDefinitionConflict)
		require.True(t, ok)

		assert.Equal(t, expected.Code, actual.Code)
		assert.Equal(t, expected.Message, actual.Message)
	case *api.UpdateFlowDefinitionBadRequest:
		expected, ok := want.(*api.UpdateFlowDefinitionBadRequest)
		require.True(t, ok)
		actual, ok := got.(*api.UpdateFlowDefinitionBadRequest)
		require.True(t, ok)

		assert.Equal(t, expected.Code, actual.Code)
		assert.Equal(t, expected.Message, actual.Message)
		assert.Equal(t, expected.Details, actual.Details)
	case *api.UpdateFlowDefinitionNotFound:
		expected, ok := want.(*api.UpdateFlowDefinitionNotFound)
		require.True(t, ok)
		actual, ok := got.(*api.UpdateFlowDefinitionNotFound)
		require.True(t, ok)

		assert.Equal(t, expected.Code, actual.Code)
		assert.Equal(t, expected.Message, actual.Message)
	case *api.ErrorDetailsStatusCode:
		expected, ok := want.(*api.ErrorDetailsStatusCode)
		require.True(t, ok)
		actual, ok := got.(*api.ErrorDetailsStatusCode)
		require.True(t, ok)

		assert.Equal(t, expected.StatusCode, actual.StatusCode)
		assert.Equal(t, expected.Response, actual.Response)
	default:
		assert.Fail(t, "unexpected response type", helpers.MustMarshal(t, got))
	}
}

func validSteps() []api.FlowDefinitionStep {
	return []api.FlowDefinitionStep{
		{
			Name:   "step_1",
			Fields: []string{"email"},
			Transitions: api.NewOptFlowDefinitionStepTransitions(map[string]api.FlowDefinitionStepTransitionsItem{
				"submit": {
					Target: "step_2",
				},
			}),
			Actions: []api.StepAction{
				{Name: "submit", Kind: api.StepActionKindSubmit, Primary: api.NewOptBool(true)},
			},
		},
		{
			Name:     "step_2",
			Complete: api.NewOptFlowDefinitionStepComplete(api.FlowDefinitionStepCompleteRedirect),
		},
	}
}

func TestGetFlowDefinitionUnauthenticated(t *testing.T) {
	t.Parallel()
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)

	getResp, err := client.GetFlowDefinition(t.Context(), api.GetFlowDefinitionParams{
		ID:        "flowDef_1234",
		ProjectID: "proj_1234",
	})
	require.NoError(t, err)
	expectedResp := &api.ErrorDetailsStatusCode{
		StatusCode: http.StatusUnauthorized,
		Response: api.ErrorDetails{
			Code:    "auth.unauthorized",
			Message: `operation GetFlowDefinition: security "": security requirement is not satisfied`,
		},
	}
	require.NoError(t, err)
	assert.Equal(t, expectedResp, getResp)
}

func TestGetFlowDefinition(t *testing.T) {
	t.Parallel()
	project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
	require.NoError(t, err)

	harness.CreateUserSchema(t, project, harness.TestData.Schemas.CreateSchemaRequestUserSchema)
	u := "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml"
	userSchemaURI, err := url.Parse(u)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	client.SetToken(project.ProjectSecret)

	createResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID: api.ProjectID(project.ID),
		FlowDefinition: api.FlowDefinition{
			Name:       "existing-flow",
			Status:     "active",
			UserSchema: *userSchemaURI,
			Purposes:   map[string]string{"login": "step_1"},
			Audience: api.OptFlowAudience{
				Value: api.FlowAudience{
					TeamIds: []string{"team-1", "team-2"},
					AppIds:  []string{"app-1", "app-2"},
				},
				Set: true,
			},
			Steps: validSteps(),
		},
	})
	flowDef, ok := createResp.(*api.FlowDefinitionDetailResponse)
	require.True(t, ok)

	tests := []struct {
		name     string
		req      api.GetFlowDefinitionParams
		wantResp api.GetFlowDefinitionRes
	}{
		{
			name: "get flow definition by id succeeds",
			req: api.GetFlowDefinitionParams{
				ProjectID: api.ProjectID(project.ID),
				ID:        flowDef.ID,
			},
			wantResp: flowDef,
		},
		{
			name: "non-existing flow definition",
			req: api.GetFlowDefinitionParams{
				ProjectID: api.ProjectID(project.ID),
				ID:        "non-existing-id",
			},
			wantResp: &api.ErrorDetailsStatusCode{
				StatusCode: http.StatusNotFound,
				Response: api.ErrorDetails{
					Code:    "flowdef.not_found",
					Message: "flow definition: not found",
				},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			resp, err := client.GetFlowDefinition(t.Context(), tt.req)
			assert.NoError(t, err)
			assertFlowDefinitionResponse(t, tt.wantResp, resp)
		})
	}
}

func TestListFlowDefinitionsUnauthenticated(t *testing.T) {
	t.Parallel()

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)

	getResp, err := client.ListFlowDefinitions(t.Context(), api.ListFlowDefinitionsParams{
		ProjectID: "proj_1234",
	})
	require.NoError(t, err)
	expectedResp := &api.ErrorDetailsStatusCode{
		StatusCode: http.StatusUnauthorized,
		Response: api.ErrorDetails{
			Code:    "auth.unauthorized",
			Message: `operation ListFlowDefinitions: security "": security requirement is not satisfied`,
		},
	}
	require.NoError(t, err)
	assert.Equal(t, expectedResp, getResp)
}

func TestListFlowDefinitions(t *testing.T) {
	t.Parallel()
	project1, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
	require.NoError(t, err)
	harness.CreateUserSchema(t, project1, harness.TestData.Schemas.CreateSchemaRequestUserSchema)

	project2, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
	require.NoError(t, err)
	harness.CreateUserSchema(t, project2, harness.TestData.Schemas.CreateSchemaRequestUserSchema)

	project3, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
	require.NoError(t, err)

	u := "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml"
	userSchemaURI, err := url.Parse(u)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)

	client.SetToken(project1.ProjectSecret)
	resp1, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID: api.ProjectID(project1.ID),
		FlowDefinition: api.FlowDefinition{
			Name:       "flow-1",
			Status:     "active",
			UserSchema: *userSchemaURI,
			Purposes:   map[string]string{"login": "step_1"},
			Audience: api.OptFlowAudience{
				Value: api.FlowAudience{
					TeamIds: []string{"team-1", "team-2"},
					AppIds:  []string{"app-1", "app-2"},
				},
				Set: true,
			},
			Steps: validSteps(),
		},
	})
	flowDef1, ok := resp1.(*api.FlowDefinitionDetailResponse)
	require.True(t, ok)

	client.SetToken(project2.ProjectSecret)
	resp2, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID: api.ProjectID(project1.ID),
		FlowDefinition: api.FlowDefinition{
			Name:       "flow-2",
			UserSchema: *userSchemaURI,
			Status:     "active",
			Purposes:   map[string]string{"profiling": "step_1"},
			Audience: api.OptFlowAudience{
				Value: api.FlowAudience{
					TeamIds: []string{"team-1", "team-2"},
					AppIds:  []string{"app-1", "app-2"},
				},
				Set: true,
			},
			Steps: validSteps(),
		},
	})
	flowDef2, ok := resp2.(*api.FlowDefinitionDetailResponse)
	require.True(t, ok)

	client.SetToken(project2.ProjectSecret)
	resp3, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID: api.ProjectID(project2.ID),
		FlowDefinition: api.FlowDefinition{
			Name:       "flow-3",
			UserSchema: *userSchemaURI,
			Status:     "active",
			Purposes:   map[string]string{"login": "step_1"},
			Audience: api.OptFlowAudience{
				Value: api.FlowAudience{
					TeamIds: []string{"team-1", "team-2"},
					AppIds:  []string{"app-1", "app-2"},
				},
				Set: true,
			},
			Steps: validSteps(),
		},
	})
	flowDef3, ok := resp3.(*api.FlowDefinitionDetailResponse)
	require.True(t, ok)

	tests := []struct {
		name     string
		req      api.ListFlowDefinitionsParams
		wantResp api.ListFlowDefinitionsRes
	}{
		{
			name: "list all flow definitions in a project",
			req: api.ListFlowDefinitionsParams{
				ProjectID: api.ProjectID(project1.ID),
			},
			wantResp: &api.FlowDefinitionListResponse{
				FlowDefinitions: []api.FlowDefinitionResponse{
					{
						Name:      "default-login",
						ProjectID: project1.ID,
					}, // for the default flow definition
					{
						ID:        flowDef1.ID,
						Name:      flowDef1.FlowDefinition.GetName(),
						Status:    flowDef1.FlowDefinition.GetStatus(),
						ProjectID: flowDef1.ProjectID,
						CreatedAt: flowDef1.CreatedAt,
						UpdatedAt: flowDef1.UpdatedAt,
					},
					{
						ID:        flowDef2.ID,
						Name:      flowDef2.FlowDefinition.GetName(),
						Status:    flowDef2.FlowDefinition.GetStatus(),
						ProjectID: flowDef2.ProjectID,
						CreatedAt: flowDef2.CreatedAt,
						UpdatedAt: flowDef2.UpdatedAt,
					},
				},
			},
		},
		{
			name: "list all flow definitions in project 2",
			req: api.ListFlowDefinitionsParams{
				ProjectID: api.ProjectID(project2.ID),
			},
			wantResp: &api.FlowDefinitionListResponse{
				FlowDefinitions: []api.FlowDefinitionResponse{
					{
						Name:      "default-login",
						ProjectID: project2.ID,
					}, // for the default flow definition
					{
						ID:        flowDef3.ID,
						Name:      flowDef3.FlowDefinition.GetName(),
						ProjectID: flowDef3.ProjectID,
						Status:    flowDef3.FlowDefinition.GetStatus(),
						CreatedAt: flowDef3.CreatedAt,
						UpdatedAt: flowDef3.UpdatedAt,
					},
				},
			},
		},
		{
			name: "list all flow definitions by purpose register",
			req: api.ListFlowDefinitionsParams{
				ProjectID: api.ProjectID(project1.ID),
				Purpose: api.OptListFlowDefinitionsPurpose{
					Value: "profiling",
					Set:   true,
				},
			},
			wantResp: &api.FlowDefinitionListResponse{
				FlowDefinitions: []api.FlowDefinitionResponse{
					{
						ID:        flowDef2.ID,
						Name:      flowDef2.FlowDefinition.GetName(),
						ProjectID: flowDef2.ProjectID,
						Status:    flowDef2.FlowDefinition.GetStatus(),
						CreatedAt: flowDef2.CreatedAt,
						UpdatedAt: flowDef2.UpdatedAt,
					},
				},
			},
		},
		{
			name: "list all flow definitions by purpose login",
			req: api.ListFlowDefinitionsParams{
				ProjectID: api.ProjectID(project1.ID),
				Purpose: api.OptListFlowDefinitionsPurpose{
					Value: "login",
					Set:   true,
				},
			},
			wantResp: &api.FlowDefinitionListResponse{
				FlowDefinitions: []api.FlowDefinitionResponse{
					{
						Name:      "default-login",
						ProjectID: project1.ID,
					}, // for the default flow definition
					{
						ID:        flowDef1.ID,
						Name:      flowDef1.FlowDefinition.GetName(),
						ProjectID: flowDef1.ProjectID,
						Status:    flowDef1.FlowDefinition.GetStatus(),
						CreatedAt: flowDef1.CreatedAt,
						UpdatedAt: flowDef1.UpdatedAt,
					},
				},
			},
		},
		{
			name: "only default flow definition",
			req: api.ListFlowDefinitionsParams{
				ProjectID: api.ProjectID(project3.ID),
			},
			wantResp: &api.FlowDefinitionListResponse{
				FlowDefinitions: []api.FlowDefinitionResponse{
					{
						Name:      "default-login",
						ProjectID: project3.ID,
					}, // for the default flow definition
				},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			client.SetToken(project1.ProjectSecret)

			resp, err := client.ListFlowDefinitions(t.Context(), tt.req)
			assert.NoError(t, err)
			expected, ok := tt.wantResp.(*api.FlowDefinitionListResponse)
			require.True(t, ok)
			actual, ok := resp.(*api.FlowDefinitionListResponse)
			require.True(t, ok)
			assert.Equal(t, len(expected.FlowDefinitions), len(actual.FlowDefinitions))
			expectedFlowDefsMap := make(map[string]api.FlowDefinitionResponse, len(expected.FlowDefinitions))
			for _, flowDef := range expected.FlowDefinitions {
				expectedFlowDefsMap[flowDef.Name] = flowDef
			}
			actualFlowDefsMap := make(map[string]api.FlowDefinitionResponse, len(actual.FlowDefinitions))
			for _, flowDef := range actual.FlowDefinitions {
				actualFlowDefsMap[flowDef.Name] = flowDef
			}

			for _, flowDef := range expected.FlowDefinitions {
				if flowDef.Name == "default-login" {
					assert.Equal(t, flowDef.ProjectID, actualFlowDefsMap[flowDef.Name].ProjectID)
					continue
				}
				assert.Equal(t, expectedFlowDefsMap[flowDef.Name].ID, actualFlowDefsMap[flowDef.Name].ID)
				assert.Equal(t, expectedFlowDefsMap[flowDef.Name].Name, actualFlowDefsMap[flowDef.Name].Name)
				assert.Equal(t, expectedFlowDefsMap[flowDef.Name].ProjectID, actualFlowDefsMap[flowDef.Name].ProjectID)
				assert.Equal(t, expectedFlowDefsMap[flowDef.Name].Status, actualFlowDefsMap[flowDef.Name].Status)
			}
		})
	}
}

func TestDeleteFlowDefinitionUnauthenticated(t *testing.T) {
	t.Parallel()
	server := harness.EnsureTestServer(t)

	client, err := helpers.NewApiClient(server.URL)
	require.NoError(t, err)

	resp, err := client.DeleteFlowDefinition(t.Context(), api.DeleteFlowDefinitionParams{
		ID:        "flowDef_1234",
		ProjectID: "proj_1234",
	})
	require.NoError(t, err)

	expectedResp := &api.ErrorDetailsStatusCode{
		StatusCode: http.StatusUnauthorized,
		Response: api.ErrorDetails{
			Code:    "auth.unauthorized",
			Message: `operation DeleteFlowDefinition: security "": security requirement is not satisfied`,
		},
	}
	assert.Equal(t, expectedResp, resp)
}

func TestDeleteFlowDefinition(t *testing.T) {
	t.Parallel()
	server := harness.EnsureTestServer(t)

	client, err := helpers.NewApiClient(server.URL)
	require.NoError(t, err)

	project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
	require.NoError(t, err)

	client.SetToken(project.ProjectSecret)

	harness.CreateUserSchema(t, project, harness.TestData.Schemas.CreateSchemaRequestUserSchema)
	u := "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml"
	userSchemaURI, err := url.Parse(u)
	require.NoError(t, err)

	createResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID: api.ProjectID(project.ID),
		FlowDefinition: api.FlowDefinition{
			Name:       "existing-flow",
			Status:     "active",
			UserSchema: *userSchemaURI,
			Purposes:   map[string]string{"login": "step_1"},
			Audience: api.OptFlowAudience{
				Value: api.FlowAudience{
					TeamIds: []string{"team-1", "team-2"},
					AppIds:  []string{"app-1", "app-2"},
				},
				Set: true,
			},
			Steps: validSteps(),
		},
	})
	assert.IsType(t, &api.FlowDefinitionDetailResponse{}, createResp, helpers.MustMarshal(t, createResp))

	flowDef, ok := createResp.(*api.FlowDefinitionDetailResponse)
	require.True(t, ok)

	tests := []struct {
		name     string
		req      api.DeleteFlowDefinitionParams
		wantResp api.DeleteFlowDefinitionRes
	}{
		{
			name: "delete flow definition succeeds",
			req: api.DeleteFlowDefinitionParams{
				ID:        flowDef.ID,
				ProjectID: api.ProjectID(project.ID),
			},
			wantResp: &api.DeleteFlowDefinitionNoContent{},
		},
		{
			name: "delete non-existing flow definition",
			req: api.DeleteFlowDefinitionParams{
				ID:        "non-existing-id",
				ProjectID: api.ProjectID(project.ID),
			},
			wantResp: &api.DeleteFlowDefinitionNoContent{},
		},
		{
			name: "invalid project id",
			req: api.DeleteFlowDefinitionParams{
				ID:        "non-existing-id",
				ProjectID: "invalid-project-id",
			},
			wantResp: &api.DeleteFlowDefinitionNoContent{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			resp, err := client.DeleteFlowDefinition(t.Context(), tt.req)
			assert.NoError(t, err)
			assert.Equal(t, tt.wantResp, resp)

			// if the flow definition is deleted, the get request should return a not found error
			getResp, err := client.GetFlowDefinition(t.Context(), api.GetFlowDefinitionParams{
				ID:        tt.req.ID,
				ProjectID: tt.req.ProjectID,
			})
			assert.NoError(t, err)
			expectedGetResp := &api.ErrorDetailsStatusCode{
				StatusCode: http.StatusNotFound,
				Response: api.ErrorDetails{
					Code:    "flowdef.not_found",
					Message: "flow definition: not found",
				},
			}
			assert.Equal(t, expectedGetResp, getResp)
		})
	}
}
