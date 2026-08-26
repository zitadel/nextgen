//go:build postgres_integration || spanner_integration

package integration_test

import (
	"net/http"
	"testing"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestCreateFlowDefinitionUnauthenticated(t *testing.T) {
	t.Parallel()

	userSchemaURI := "https://some-tenant.com/schemas/unknown-user-schema.yaml"

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)

	resp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID: "proj_1234",
		FlowDefinition: api.FlowDefinition{
			Name:       "login-flow",
			Status:     "active",
			UserSchema: userSchemaURI,
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
	assertFlowDefinitionResponse(t, &api.ErrorDetailsStatusCode{
		StatusCode: http.StatusUnauthorized,
		Response: api.ErrorDetails{
			Code:    "auth.unauthorized",
			Message: "The request lacks valid authentication credentials.",
		},
	}, resp)
}

func TestCreateFlowDefinition(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	harness.CreateUserSchema(t, project, harness.EnsureTestData(t).Schemas.CreateSchemaRequestUserSchema)

	userSchemaURI := "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml"

	unknownUserSchemaURI := "https://some-tenant.com/schemas/unknown-user-schema.yaml"

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	_, err = client.CreateFlowDefinition(
		t.Context(),
		newCreateFlowDefinitionRequest(api.ProjectID(project.ID), newFlowDefinitionFixture("existing-flow", userSchemaURI)),
	)
	require.NoError(t, err)

	tests := []struct {
		name     string
		req      *api.CreateFlowDefinitionRequest
		wantResp api.CreateFlowDefinitionRes
	}{
		{
			name: "flow definition created successfully",
			req:  newCreateFlowDefinitionRequest(api.ProjectID(project.ID), newFlowDefinitionFixture("login-flow", userSchemaURI)),
			wantResp: &api.FlowDefinitionDetailResponse{
				ProjectID: project.ID,
				FlowDefinition: api.FlowDefinition{
					Name:       "login-flow",
					UserSchema: userSchemaURI,
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
			req:  newCreateFlowDefinitionRequest(api.ProjectID(project.ID), newFlowDefinitionFixture("login-flow-2", unknownUserSchemaURI)),
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
			req:  newCreateFlowDefinitionRequest(api.ProjectID(project.ID), newFlowDefinitionFixture("existing-flow", userSchemaURI)),
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
					UserSchema: userSchemaURI,
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
					UserSchema: userSchemaURI,
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
					UserSchema: userSchemaURI,
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

	userSchemaURI := "https://some-tenant.com/schemas/unknown-user-schema.yaml"

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)

	resp, err := client.UpdateFlowDefinition(t.Context(), &api.FlowDefinitionUpdateRequest{
		FlowDefinition: api.FlowDefinition{
			Name:       "login-flow",
			Status:     "active",
			UserSchema: userSchemaURI,
			Purposes:   map[string]string{"login": "step_1"},
			Steps:      validSteps(),
		},
	}, api.UpdateFlowDefinitionParams{
		ID: "flowDef_1234",
	})
	require.NoError(t, err)
	assertFlowDefinitionResponse(t, &api.ErrorDetailsStatusCode{
		StatusCode: http.StatusUnauthorized,
		Response: api.ErrorDetails{
			Code:    "auth.unauthorized",
			Message: "The request lacks valid authentication credentials.",
		},
	}, resp)
}

func TestUpdateFlowDefinition(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	harness.CreateUserSchema(t, project, harness.EnsureTestData(t).Schemas.CreateSchemaRequestUserSchema)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	userSchemaURI := "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml"

	unknownUserSchemaURI := "https://some-tenant.com/schemas/unknown-user-schema.yaml"

	createResp, err := client.CreateFlowDefinition(
		t.Context(),
		newCreateFlowDefinitionRequest(api.ProjectID(project.ID), newFlowDefinitionFixture("login-flow", userSchemaURI)),
	)
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionDetailResponse{}, createResp, helpers.MustMarshal(t, createResp))
	loginFlowDef := createResp.(*api.FlowDefinitionDetailResponse)

	multiPurposeResp, err := client.CreateFlowDefinition(
		t.Context(),
		newCreateFlowDefinitionRequest(api.ProjectID(project.ID), func() api.FlowDefinition {
			def := newFlowDefinitionFixture("multi-purpose-flow", userSchemaURI)
			def.Purposes = map[string]string{
				"login":    "step_1",
				"recovery": "step_1",
			}
			return def
		}()),
	)
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionDetailResponse{}, multiPurposeResp, helpers.MustMarshal(t, multiPurposeResp))
	loginRegisterFlowDef := multiPurposeResp.(*api.FlowDefinitionDetailResponse)

	tests := []struct {
		name     string
		req      *api.FlowDefinitionUpdateRequest
		params   api.UpdateFlowDefinitionParams
		wantResp api.UpdateFlowDefinitionRes
	}{
		{
			name: "flow definition updated successfully",
			req: newUpdateFlowDefinitionRequest(func() api.FlowDefinition {
				def := newFlowDefinitionFixture("updated-flow", userSchemaURI)
				def.Audience = api.OptFlowAudience{
					Value: api.FlowAudience{TeamIds: []string{"team-2"}, AppIds: []string{"app-2"}},
					Set:   true,
				}
				return def
			}()),
			params: api.UpdateFlowDefinitionParams{ID: loginFlowDef.ID},
			wantResp: &api.FlowDefinitionDetailResponse{
				ID:        loginFlowDef.ID,
				ProjectID: project.ID,
				FlowDefinition: api.FlowDefinition{
					Name:       "updated-flow",
					UserSchema: userSchemaURI,
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
				def := newFlowDefinitionFixture("multi-purpose-flow-updated", userSchemaURI)
				def.Purposes = map[string]string{
					"login": "step_1", // remove recovery
				}
				def.Status = api.FlowDefinitionStatusDraft // deactivate while removing recovery
				return def
			}()),
			params: api.UpdateFlowDefinitionParams{ID: loginRegisterFlowDef.ID},
			wantResp: &api.UpdateFlowDefinitionErrorResponseStatusCode{
				StatusCode: http.StatusConflict,
				Response: api.NewFlowdefUpdateConflictUpdateFlowDefinitionErrorResponse(api.FlowdefUpdateConflict{
					Code:    "flowdef.update_conflict",
					Message: "flow definition: update conflict",
					Details: api.OptFlowdefUpdateConflictDetails{
						Value: api.FlowdefUpdateConflictDetails{
							"details": jx.Raw(`"cannot update: no other active flow definition found with purpose \"recovery\""`),
						},
						Set: true,
					},
				}),
			},
		},
		{
			name: "active update removing old purpose fails when removed purpose has no alternate active definition",
			req: newUpdateFlowDefinitionRequest(func() api.FlowDefinition {
				def := newFlowDefinitionFixture("multi-purpose-flow-remove-recovery", userSchemaURI)
				def.Purposes = map[string]string{
					"login": "step_1", // remove recovery while staying active
				}
				def.Status = api.FlowDefinitionStatusActive
				return def
			}()),
			params: api.UpdateFlowDefinitionParams{ID: loginRegisterFlowDef.ID},
			wantResp: &api.UpdateFlowDefinitionErrorResponseStatusCode{
				StatusCode: http.StatusConflict,
				Response: api.NewFlowdefUpdateConflictUpdateFlowDefinitionErrorResponse(api.FlowdefUpdateConflict{
					Code:    "flowdef.update_conflict",
					Message: "flow definition: update conflict",
					Details: api.OptFlowdefUpdateConflictDetails{
						Value: api.FlowdefUpdateConflictDetails{
							"details": jx.Raw(`"cannot update: no other active flow definition found with purpose \"recovery\""`),
						},
						Set: true,
					},
				}),
			},
		},
		{
			name: "active update removing purpose succeeds when alternate active definition exists",
			req: newUpdateFlowDefinitionRequest(func() api.FlowDefinition {
				def := newFlowDefinitionFixture("multi-purpose-flow-remove-login", userSchemaURI)
				def.Purposes = map[string]string{
					"recovery": "step_1", // remove login
				}
				def.Status = api.FlowDefinitionStatusActive
				return def
			}()),
			params: api.UpdateFlowDefinitionParams{ID: loginRegisterFlowDef.ID},
			wantResp: &api.FlowDefinitionDetailResponse{
				ID:        loginRegisterFlowDef.ID,
				ProjectID: project.ID,
				FlowDefinition: api.FlowDefinition{
					Name:       "multi-purpose-flow-remove-login",
					UserSchema: userSchemaURI,
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
			req:    newUpdateFlowDefinitionRequest(newFlowDefinitionFixture("updated-flow", userSchemaURI)),
			params: api.UpdateFlowDefinitionParams{ID: "flowdef_missing"},
			wantResp: &api.UpdateFlowDefinitionNotFound{
				Code:    "flowdef.not_found",
				Message: "flow definition: not found",
			},
		},
		{
			name:   "unknown user schema",
			req:    newUpdateFlowDefinitionRequest(newFlowDefinitionFixture("updated-flow", unknownUserSchemaURI)),
			params: api.UpdateFlowDefinitionParams{ID: loginFlowDef.ID},
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
				def := newFlowDefinitionFixture("updated-flow", userSchemaURI)
				def.Purposes = map[string]string{"login": "collect_identifier"}
				return def
			}()),
			params: api.UpdateFlowDefinitionParams{ID: loginFlowDef.ID},
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

func newFlowDefinitionFixture(name string, userSchemaURI string) api.FlowDefinition {
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

	// An expectation written as the generic *api.ErrorDetailsStatusCode says
	// "this status with this code" and nothing about which Go type carries it.
	// Operations wired to an operation-specific default response answer with
	// their own wrapper, so compare those structurally instead of by type —
	// otherwise every such expectation would have to be restated as a sum-type
	// literal to assert the same two fields.
	if expected, isGeneric := want.(*api.ErrorDetailsStatusCode); isGeneric {
		if status, code, message, ok := errorResponseParts(t, got); ok {
			assert.Equal(t, expected.StatusCode, status, helpers.MustMarshal(t, got))
			assert.Equal(t, string(expected.Response.Code), code, helpers.MustMarshal(t, got))
			assert.Equal(t, expected.Response.Message, message, helpers.MustMarshal(t, got))
			return
		}
	}

	if !assert.IsType(t, want, got) {
		return
	}

	switch expected := want.(type) {
	case *api.FlowDefinitionDetailResponse:
		require.IsType(t, &api.FlowDefinitionDetailResponse{}, got, helpers.MustMarshal(t, got))
		actual := got.(*api.FlowDefinitionDetailResponse)

		assert.NotEmpty(t, actual.ID)
		assert.Equal(t, expected.ProjectID, actual.ProjectID)
		assert.Equal(t, expected.FlowDefinition, actual.FlowDefinition)
	case *api.CreateFlowDefinitionBadRequest:
		require.IsType(t, &api.CreateFlowDefinitionBadRequest{}, got, helpers.MustMarshal(t, got))
		actual := got.(*api.CreateFlowDefinitionBadRequest)

		assert.Equal(t, expected.Code, actual.Code)
		assert.Equal(t, expected.Message, actual.Message)
		assert.Equal(t, expected.Details, actual.Details)
	case *api.CreateFlowDefinitionConflict:
		require.IsType(t, &api.CreateFlowDefinitionConflict{}, got, helpers.MustMarshal(t, got))
		actual := got.(*api.CreateFlowDefinitionConflict)

		assert.Equal(t, expected.Code, actual.Code)
		assert.Equal(t, expected.Message, actual.Message)
	case *api.UpdateFlowDefinitionBadRequest:
		require.IsType(t, &api.UpdateFlowDefinitionBadRequest{}, got, helpers.MustMarshal(t, got))
		actual := got.(*api.UpdateFlowDefinitionBadRequest)

		assert.Equal(t, expected.Code, actual.Code)
		assert.Equal(t, expected.Message, actual.Message)
		assert.Equal(t, expected.Details, actual.Details)
	case *api.UpdateFlowDefinitionNotFound:
		require.IsType(t, &api.UpdateFlowDefinitionNotFound{}, got, helpers.MustMarshal(t, got))
		actual := got.(*api.UpdateFlowDefinitionNotFound)

		assert.Equal(t, expected.Code, actual.Code)
		assert.Equal(t, expected.Message, actual.Message)
	case *api.ErrorDetailsStatusCode:
		require.IsType(t, &api.ErrorDetailsStatusCode{}, got, helpers.MustMarshal(t, got))
		actual := got.(*api.ErrorDetailsStatusCode)

		assert.Equal(t, expected.StatusCode, actual.StatusCode)
		assert.Equal(t, expected.Response.Code, actual.Response.Code)
		assert.Equal(t, expected.Response.Message, actual.Response.Message)
	// The operation-specific error responses are discriminated unions, so the
	// variant is the assertion: matching on Type proves the server sent the
	// code this case expects, and the payload compare covers message and
	// details.
	case *api.UpdateFlowDefinitionErrorResponseStatusCode:
		require.IsType(t, &api.UpdateFlowDefinitionErrorResponseStatusCode{}, got, helpers.MustMarshal(t, got))
		actual := got.(*api.UpdateFlowDefinitionErrorResponseStatusCode)

		assert.Equal(t, expected.StatusCode, actual.StatusCode)
		assert.Equal(t, expected.Response.Type, actual.Response.Type)
		assert.Equal(t, expected.Response, actual.Response)
	case *api.GetFlowDefinitionErrorResponseStatusCode:
		require.IsType(t, &api.GetFlowDefinitionErrorResponseStatusCode{}, got, helpers.MustMarshal(t, got))
		actual := got.(*api.GetFlowDefinitionErrorResponseStatusCode)

		assert.Equal(t, expected.StatusCode, actual.StatusCode)
		assert.Equal(t, expected.Response.Type, actual.Response.Type)
		assert.Equal(t, expected.Response, actual.Response)
	case *api.DeleteFlowDefinitionErrorResponseStatusCode:
		require.IsType(t, &api.DeleteFlowDefinitionErrorResponseStatusCode{}, got, helpers.MustMarshal(t, got))
		actual := got.(*api.DeleteFlowDefinitionErrorResponseStatusCode)

		assert.Equal(t, expected.StatusCode, actual.StatusCode)
		assert.Equal(t, expected.Response.Type, actual.Response.Type)
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
		ID: "flowDef_1234",
	})

	require.NoError(t, err)
	assertFlowDefinitionResponse(t, &api.ErrorDetailsStatusCode{
		StatusCode: http.StatusUnauthorized,
		Response: api.ErrorDetails{
			Code:    "auth.unauthorized",
			Message: "The request lacks valid authentication credentials.",
		},
	}, getResp)
}

func TestGetFlowDefinition(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	harness.CreateUserSchema(t, project, harness.EnsureTestData(t).Schemas.CreateSchemaRequestUserSchema)
	userSchemaURI := "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml"

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	createResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID: api.ProjectID(project.ID),
		FlowDefinition: api.FlowDefinition{
			Name:       "existing-flow",
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
		},
	})
	require.IsType(t, &api.FlowDefinitionDetailResponse{}, createResp, helpers.MustMarshal(t, createResp))
	flowDef := createResp.(*api.FlowDefinitionDetailResponse)

	tests := []struct {
		name     string
		req      api.GetFlowDefinitionParams
		wantResp api.GetFlowDefinitionRes
	}{
		{
			name: "get flow definition by id succeeds",
			req: api.GetFlowDefinitionParams{
				ID: flowDef.ID,
			},
			wantResp: flowDef,
		},
		{
			name: "non-existing flow definition",
			req: api.GetFlowDefinitionParams{
				ID: "non-existing-id",
			},
			wantResp: &api.GetFlowDefinitionErrorResponseStatusCode{
				StatusCode: http.StatusNotFound,
				Response: api.NewFlowdefNotFoundGetFlowDefinitionErrorResponse(api.FlowdefNotFound{
					Code:    "flowdef.not_found",
					Message: "flow definition: not found",
				}),
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

	assertFlowDefinitionResponse(t, &api.ErrorDetailsStatusCode{
		StatusCode: http.StatusUnauthorized,
		Response: api.ErrorDetails{
			Code:    "auth.unauthorized",
			Message: "The request lacks valid authentication credentials.",
		},
	}, getResp)
}

func TestListFlowDefinitions(t *testing.T) {
	t.Parallel()

	project1, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	harness.CreateUserSchema(t, project1, harness.EnsureTestData(t).Schemas.CreateSchemaRequestUserSchema)

	project2, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	harness.CreateUserSchema(t, project2, harness.EnsureTestData(t).Schemas.CreateSchemaRequestUserSchema)

	project3, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	userSchemaURI := "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml"

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)

	harness.SetProjectSecretOnApiClient(t, client, project1)
	resp1, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID: api.ProjectID(project1.ID),
		FlowDefinition: api.FlowDefinition{
			Name:       "flow-1",
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
		},
	})
	require.IsType(t, &api.FlowDefinitionDetailResponse{}, resp1, helpers.MustMarshal(t, resp1))
	flowDef1 := resp1.(*api.FlowDefinitionDetailResponse)

	//harness.SetProjectSecretOnApiClient(t, client, project2) // TODO CHECK
	resp2, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID: api.ProjectID(project1.ID),
		FlowDefinition: api.FlowDefinition{
			Name:       "flow-2",
			UserSchema: userSchemaURI,
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
	require.IsType(t, &api.FlowDefinitionDetailResponse{}, resp2, helpers.MustMarshal(t, resp2))
	flowDef2 := resp2.(*api.FlowDefinitionDetailResponse)

	harness.SetProjectSecretOnApiClient(t, client, project2)
	resp3, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID: api.ProjectID(project2.ID),
		FlowDefinition: api.FlowDefinition{
			Name:       "flow-3",
			UserSchema: userSchemaURI,
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
	require.IsType(t, &api.FlowDefinitionDetailResponse{}, resp3, helpers.MustMarshal(t, resp3))
	flowDef3 := resp3.(*api.FlowDefinitionDetailResponse)

	tests := []struct {
		name     string
		project  *domain.Project
		req      api.ListFlowDefinitionsParams
		wantResp api.ListFlowDefinitionsRes
	}{
		{
			name:    "list all flow definitions in a project",
			project: project1,
			req: api.ListFlowDefinitionsParams{
				ProjectID: api.ProjectID(project1.ID),
			},
			wantResp: &api.FlowDefinitionListResponse{
				FlowDefinitions: []api.FlowDefinitionDetailResponse{
					{
						FlowDefinition: api.FlowDefinition{Name: "default-login"},
						ProjectID:      project1.ID,
					}, // for the default flow definition
					*flowDef1,
					*flowDef2,
				},
			},
		},
		{
			name:    "list all flow definitions in project 2",
			project: project2,
			req: api.ListFlowDefinitionsParams{
				ProjectID: api.ProjectID(project2.ID),
			},
			wantResp: &api.FlowDefinitionListResponse{
				FlowDefinitions: []api.FlowDefinitionDetailResponse{
					{
						FlowDefinition: api.FlowDefinition{Name: "default-login"},
						ProjectID:      project2.ID,
					}, // for the default flow definition
					*flowDef3,
				},
			},
		},
		{
			name:    "list all flow definitions by purpose register",
			project: project1,
			req: api.ListFlowDefinitionsParams{
				ProjectID: api.ProjectID(project1.ID),
				Purpose: api.OptListFlowDefinitionsPurpose{
					Value: "profiling",
					Set:   true,
				},
			},
			wantResp: &api.FlowDefinitionListResponse{
				FlowDefinitions: []api.FlowDefinitionDetailResponse{
					*flowDef2,
				},
			},
		},
		{
			name:    "list all flow definitions by purpose login",
			project: project1,
			req: api.ListFlowDefinitionsParams{
				ProjectID: api.ProjectID(project1.ID),
				Purpose: api.OptListFlowDefinitionsPurpose{
					Value: "login",
					Set:   true,
				},
			},
			wantResp: &api.FlowDefinitionListResponse{
				FlowDefinitions: []api.FlowDefinitionDetailResponse{
					{
						FlowDefinition: api.FlowDefinition{Name: "default-login"},
						ProjectID:      project1.ID,
					}, // for the default flow definition
					*flowDef1,
				},
			},
		},
		{
			name:    "only default flow definition",
			project: project3,
			req: api.ListFlowDefinitionsParams{
				ProjectID: api.ProjectID(project3.ID),
			},
			wantResp: &api.FlowDefinitionListResponse{
				FlowDefinitions: []api.FlowDefinitionDetailResponse{
					{
						FlowDefinition: api.FlowDefinition{Name: "default-login"},
						ProjectID:      project3.ID,
					}, // for the default flow definition
				},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			// Fresh client per subtest: the management API is bound to the
			// token's project, and mutating a shared client's token inside
			// parallel subtests would race.
			client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
			require.NoError(t, err)
			harness.SetProjectSecretOnApiClient(t, client, tt.project)

			resp, err := client.ListFlowDefinitions(t.Context(), tt.req)
			assert.NoError(t, err)

			require.IsType(t, &api.FlowDefinitionListResponse{}, tt.wantResp, helpers.MustMarshal(t, tt.wantResp))
			expected := tt.wantResp.(*api.FlowDefinitionListResponse)

			require.IsType(t, &api.FlowDefinitionListResponse{}, resp, helpers.MustMarshal(t, resp))
			actual := resp.(*api.FlowDefinitionListResponse)

			assert.Equal(t, len(expected.FlowDefinitions), len(actual.FlowDefinitions))
			actualFlowDefsMap := make(map[string]api.FlowDefinitionDetailResponse, len(actual.FlowDefinitions))
			for _, flowDef := range actual.FlowDefinitions {
				actualFlowDefsMap[flowDef.FlowDefinition.Name] = flowDef
			}

			for _, flowDef := range expected.FlowDefinitions {
				name := flowDef.FlowDefinition.Name
				// The default definition is server-seeded, so its id, document
				// and timestamps are not knowable here.
				if name == "default-login" {
					assert.Equal(t, flowDef.ProjectID, actualFlowDefsMap[name].ProjectID)
					continue
				}
				got := actualFlowDefsMap[name]
				// A directory row renders last-changed, so the list's own
				// timestamps have to be real.
				assert.False(t, got.CreatedAt.IsZero())
				assert.False(t, got.UpdatedAt.IsZero())
				// The create response they are compared against carries zero
				// timestamps: CreateFlowDefinition writes NOW() without reading
				// it back, on every dialect. Everything else must match, because
				// the list and the by-id read describe a flow definition the
				// same way (#939) — document, purposes, audience and steps.
				want := flowDef
				want.CreatedAt, want.UpdatedAt = got.CreatedAt, got.UpdatedAt
				assert.Equal(t, want, got)
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
		ID: "flowDef_1234",
	})

	require.NoError(t, err)
	assertFlowDefinitionResponse(t, &api.ErrorDetailsStatusCode{
		StatusCode: http.StatusUnauthorized,
		Response: api.ErrorDetails{
			Code:    "auth.unauthorized",
			Message: "The request lacks valid authentication credentials.",
		},
	}, resp)
}

func TestDeleteFlowDefinition(t *testing.T) {
	t.Parallel()
	server := harness.EnsureTestServer(t)

	client, err := helpers.NewApiClient(server.URL)
	require.NoError(t, err)

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	harness.SetProjectSecretOnApiClient(t, client, project)

	harness.CreateUserSchema(t, project, harness.EnsureTestData(t).Schemas.CreateSchemaRequestUserSchema)
	userSchemaURI := "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml"

	createResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID: api.ProjectID(project.ID),
		FlowDefinition: api.FlowDefinition{
			Name:       "existing-flow",
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
		},
	})
	assert.IsType(t, &api.FlowDefinitionDetailResponse{}, createResp, helpers.MustMarshal(t, createResp))

	require.IsType(t, &api.FlowDefinitionDetailResponse{}, createResp, helpers.MustMarshal(t, createResp))
	flowDef := createResp.(*api.FlowDefinitionDetailResponse)

	tests := []struct {
		name     string
		req      api.DeleteFlowDefinitionParams
		wantResp api.DeleteFlowDefinitionRes
	}{
		{
			name: "delete flow definition succeeds",
			req: api.DeleteFlowDefinitionParams{
				ID: flowDef.ID,
			},
			wantResp: &api.DeleteFlowDefinitionNoContent{},
		},
		{
			// Flat-by-id: missing RSI is indistinguishable from never existed → 204.
			name: "delete non-existing flow definition",
			req: api.DeleteFlowDefinitionParams{
				ID: "non-existing-id",
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
				ID: tt.req.ID,
			})

			assert.NoError(t, err)
			assertFlowDefinitionResponse(t, &api.ErrorDetailsStatusCode{
				StatusCode: http.StatusNotFound,
				Response: api.ErrorDetails{
					Code:    "flowdef.not_found",
					Message: "flow definition: not found",
				},
			}, getResp)
		})
	}
}
