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

	client := harness.EnsureAnonymousAPIClient(t)
	resp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID: "proj_1234",
		FlowDefinition: api.FlowDefinition{
			Name:       "login-flow",
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
			Message: `operation CreateFlowDefinition: security "OAuth2": security requirement is not satisfied`,
		},
	}
	require.NoError(t, err)
	assert.Equal(t, expectedResp, resp)
}

func TestCreateFlowDefinition(t *testing.T) {
	t.Parallel()
	project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
	require.NoError(t, err)
	harness.CreateUserSchema(t, project.ID, harness.TestData.Schemas.CreateSchemaRequestUserSchema)

	u := "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml"
	userSchemaURI, err := url.Parse(u)
	require.NoError(t, err)

	unknownUserSchema := "https://some-tenant.com/schemas/unknown-user-schema.yaml"
	unknownUserSchemaURI, err := url.Parse(unknownUserSchema)
	require.NoError(t, err)

	_, err = harness.EnsureAPIClient(t, project.ID).CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID: api.ProjectID(project.ID),
		FlowDefinition: api.FlowDefinition{
			Name:       "existing-flow",
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
	require.NoError(t, err)

	tests := []struct {
		name     string
		req      *api.CreateFlowDefinitionRequest
		wantResp api.CreateFlowDefinitionRes
	}{
		{
			name: "flow definition created successfully",
			req: &api.CreateFlowDefinitionRequest{
				ProjectID: api.ProjectID(project.ID),
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
					Steps: []api.FlowDefinitionStep{
						{
							Name:   "step_1",
							Fields: []string{"email"},
							Transitions: api.NewOptFlowDefinitionStepTransitions(map[string]api.FlowDefinitionStepTransitionsItem{
								"submit": {
									Target: "step_2",
								},
							}),
							Actions: api.NewOptFlowDefinitionStepActions(map[string]api.StepAction{
								"submit": {
									Primary: api.NewOptBool(true),
								},
							}),
						},
						{
							Name:     "step_2",
							Complete: api.NewOptFlowDefinitionStepComplete(api.FlowDefinitionStepCompleteRedirect),
						},
					},
				},
			},
			wantResp: &api.FlowDefinitionDetailResponse{
				ProjectID: project.ID,
				Status:    "active",
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
					Steps: validSteps(),
				},
			},
		},
		{
			name: "unknown user schema",
			req: &api.CreateFlowDefinitionRequest{
				ProjectID: api.ProjectID(project.ID),
				FlowDefinition: api.FlowDefinition{
					Name:       "login-flow-2",
					UserSchema: *unknownUserSchemaURI,
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
			},
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
			req: &api.CreateFlowDefinitionRequest{
				ProjectID: api.ProjectID(project.ID),
				FlowDefinition: api.FlowDefinition{
					Name:       "existing-flow",
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
			},
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
							Actions: api.NewOptFlowDefinitionStepActions(map[string]api.StepAction{
								"submit": {
									Primary: api.NewOptBool(true),
								},
							}),
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
							Actions: api.NewOptFlowDefinitionStepActions(map[string]api.StepAction{
								"submit": {
									Primary: api.NewOptBool(true),
								},
							}),
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
						"details": jx.Raw(`"step \"step_1\": field \"username\" is not a property in the user schema"`),
					},
					Set: true,
				},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			client := harness.EnsureAPIClient(t, project.ID)
			resp, err := client.CreateFlowDefinition(t.Context(), tt.req)
			assert.NoError(t, err)
			assertFlowDefinitionResponse(t, tt.wantResp, resp)
		})
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
		assert.Equal(t, expected.Status, actual.Status)
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
			Actions: api.NewOptFlowDefinitionStepActions(map[string]api.StepAction{
				"submit": {
					Primary: api.NewOptBool(true),
				},
			}),
		},
		{
			Name:     "step_2",
			Complete: api.NewOptFlowDefinitionStepComplete(api.FlowDefinitionStepCompleteRedirect),
		},
	}
}

func TestGetFlowDefinitionUnauthenticated(t *testing.T) {
	t.Parallel()
	client := harness.EnsureAnonymousAPIClient(t)
	getResp, err := client.GetFlowDefinition(t.Context(), api.GetFlowDefinitionParams{
		ID:        "flowDef_1234",
		ProjectID: "proj_1234",
	})
	require.NoError(t, err)
	expectedResp := &api.ErrorDetailsStatusCode{
		StatusCode: http.StatusUnauthorized,
		Response: api.ErrorDetails{
			Code:    "auth.unauthorized",
			Message: `operation GetFlowDefinition: security "OAuth2": security requirement is not satisfied`,
		},
	}
	require.NoError(t, err)
	assert.Equal(t, expectedResp, getResp)
}

func TestGetFlowDefinition(t *testing.T) {
	t.Parallel()
	project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
	require.NoError(t, err)
	harness.CreateUserSchema(t, project.ID, harness.TestData.Schemas.CreateSchemaRequestUserSchema)
	u := "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml"
	userSchemaURI, err := url.Parse(u)
	require.NoError(t, err)

	createResp, err := harness.EnsureAPIClient(t, project.ID).CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID: api.ProjectID(project.ID),
		FlowDefinition: api.FlowDefinition{
			Name:       "existing-flow",
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
			client := harness.EnsureAPIClient(t, project.ID)
			resp, err := client.GetFlowDefinition(t.Context(), tt.req)
			assert.NoError(t, err)
			assertFlowDefinitionResponse(t, tt.wantResp, resp)
		})
	}
}

func TestListFlowDefinitionsUnauthenticated(t *testing.T) {
	t.Parallel()

	client := harness.EnsureAnonymousAPIClient(t)
	getResp, err := client.ListFlowDefinitions(t.Context(), api.ListFlowDefinitionsParams{
		ProjectID: "proj_1234",
	})
	require.NoError(t, err)
	expectedResp := &api.ErrorDetailsStatusCode{
		StatusCode: http.StatusUnauthorized,
		Response: api.ErrorDetails{
			Code:    "auth.unauthorized",
			Message: `operation ListFlowDefinitions: security "OAuth2": security requirement is not satisfied`,
		},
	}
	require.NoError(t, err)
	assert.Equal(t, expectedResp, getResp)
}

func TestListFlowDefinitions(t *testing.T) {
	t.Parallel()
	project1, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
	require.NoError(t, err)
	harness.CreateUserSchema(t, project1.ID, harness.TestData.Schemas.CreateSchemaRequestUserSchema)

	project2, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
	require.NoError(t, err)
	harness.CreateUserSchema(t, project2.ID, harness.TestData.Schemas.CreateSchemaRequestUserSchema)

	project3, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
	require.NoError(t, err)

	u := "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml"
	userSchemaURI, err := url.Parse(u)
	require.NoError(t, err)

	resp1, err := harness.EnsureAPIClient(t, project1.ID).CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID: api.ProjectID(project1.ID),
		FlowDefinition: api.FlowDefinition{
			Name:       "flow-1",
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

	resp2, err := harness.EnsureAPIClient(t, project1.ID).CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID: api.ProjectID(project1.ID),
		FlowDefinition: api.FlowDefinition{
			Name:       "flow-2",
			UserSchema: *userSchemaURI,
			Purposes:   map[string]string{"register": "step_1"},
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

	resp3, err := harness.EnsureAPIClient(t, project2.ID).CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID: api.ProjectID(project2.ID),
		FlowDefinition: api.FlowDefinition{
			Name:       "flow-3",
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
						ProjectID: flowDef1.ProjectID,
						Status:    flowDef1.Status,
						CreatedAt: flowDef1.CreatedAt.Local(), // todo: review tz
						UpdatedAt: flowDef1.UpdatedAt.Local(),
					},
					{
						ID:        flowDef2.ID,
						Name:      flowDef2.FlowDefinition.GetName(),
						ProjectID: flowDef2.ProjectID,
						Status:    flowDef2.Status,
						CreatedAt: flowDef2.CreatedAt.Local(),
						UpdatedAt: flowDef2.UpdatedAt.Local(),
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
						Status:    flowDef3.Status,
						CreatedAt: flowDef3.CreatedAt.Local(), // todo: review tz
						UpdatedAt: flowDef3.UpdatedAt.Local(),
					},
				},
			},
		},
		{
			name: "list all flow definitions by purpose register",
			req: api.ListFlowDefinitionsParams{
				ProjectID: api.ProjectID(project1.ID),
				Purpose: api.OptListFlowDefinitionsPurpose{
					Value: "register",
					Set:   true,
				},
			},
			wantResp: &api.FlowDefinitionListResponse{
				FlowDefinitions: []api.FlowDefinitionResponse{
					{
						ID:        flowDef2.ID,
						Name:      flowDef2.FlowDefinition.GetName(),
						ProjectID: flowDef2.ProjectID,
						Status:    flowDef2.Status,
						CreatedAt: flowDef2.CreatedAt.Local(), // todo: review tz
						UpdatedAt: flowDef2.UpdatedAt.Local(),
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
						Status:    flowDef1.Status,
						CreatedAt: flowDef1.CreatedAt.Local(), // todo: review tz
						UpdatedAt: flowDef1.UpdatedAt.Local(),
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
			client := harness.EnsureAPIClient(t, project1.ID)
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
				assert.Equal(t, expectedFlowDefsMap[flowDef.Name], actualFlowDefsMap[flowDef.Name])
			}
		})
	}
}
