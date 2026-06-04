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
	project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
	require.NoError(t, err)
	harness.CreateUserSchema(t, project.ID, harness.TestData.Schemas.CreateSchemaRequestUserSchema)

	userSchema := "https://some-tenant.com/schemas/unknown-user-schema.yaml"
	userSchemaURI, err := url.Parse(userSchema)
	require.NoError(t, err)

	client := harness.EnsureAnonymousAPIClient(t)
	resp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
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
				FlowDefinition: api.NewOptFlowDefinition(
					api.FlowDefinition{
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
					}),
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

func assertFlowDefinitionResponse(t *testing.T, want, got api.CreateFlowDefinitionRes) {
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
