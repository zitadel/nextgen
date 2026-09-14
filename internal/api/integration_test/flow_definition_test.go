//go:build postgres_integration || spanner_integration

package integration_test

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
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

	existingResp, err := client.CreateFlowDefinition(
		t.Context(),
		newCreateFlowDefinitionRequest(api.ProjectID(project.ID), newFlowDefinitionFixture("existing-flow", userSchemaURI)),
	)
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, existingResp, helpers.MustMarshal(t, existingResp))
	existing := existingResp.(*api.FlowDefinitionResponse)

	tests := []struct {
		name     string
		req      *api.CreateFlowDefinitionRequest
		wantResp api.CreateFlowDefinitionRes
	}{
		{
			name: "flow definition created successfully",
			req:  newCreateFlowDefinitionRequest(api.ProjectID(project.ID), newFlowDefinitionFixture("login-flow", userSchemaURI)),
			wantResp: &api.FlowDefinitionResponse{
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
			wantResp: &api.ErrorDetails{
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
			name: "same name publishes a new revision",
			req:  newCreateFlowDefinitionRequest(api.ProjectID(project.ID), newFlowDefinitionFixture("existing-flow", userSchemaURI)),
			wantResp: &api.FlowDefinitionResponse{
				ProjectID:      project.ID,
				FlowDefinition: newFlowDefinitionFixture("existing-flow", userSchemaURI),
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
			wantResp: &api.ErrorDetails{
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
			wantResp: &api.ErrorDetails{
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
			wantResp: &api.ErrorDetails{
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
			if created, ok := resp.(*api.FlowDefinitionResponse); ok {
				assert.NotEqual(t, existing.ID, created.ID, "every create allocates a new revision id")
			}
		})
	}
}

func newCreateFlowDefinitionRequest(projectID api.ProjectID, definition api.FlowDefinition) *api.CreateFlowDefinitionRequest {
	return &api.CreateFlowDefinitionRequest{
		ProjectID:      projectID,
		FlowDefinition: definition,
	}
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
	case *api.FlowDefinitionResponse:
		require.IsType(t, &api.FlowDefinitionResponse{}, got, helpers.MustMarshal(t, got))
		actual := got.(*api.FlowDefinitionResponse)

		assert.NotEmpty(t, actual.ID)
		assert.Equal(t, expected.ProjectID, actual.ProjectID)
		assert.Equal(t, expected.FlowDefinition, actual.FlowDefinition)
		assert.False(t, actual.CreatedAt.IsZero())
		assert.False(t, actual.UpdatedAt.IsZero())
	case *api.ErrorDetails:
		require.IsType(t, &api.ErrorDetails{}, got, helpers.MustMarshal(t, got))
		actual := got.(*api.ErrorDetails)

		assert.Equal(t, expected.Code, actual.Code)
		assert.Equal(t, expected.Message, actual.Message)
		assert.Equal(t, expected.Details, actual.Details)
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
	case *api.GetFlowDefinitionErrorResponseStatusCode:
		require.IsType(t, &api.GetFlowDefinitionErrorResponseStatusCode{}, got, helpers.MustMarshal(t, got))
		actual := got.(*api.GetFlowDefinitionErrorResponseStatusCode)

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
	require.IsType(t, &api.FlowDefinitionResponse{}, createResp, helpers.MustMarshal(t, createResp))
	flowDef := createResp.(*api.FlowDefinitionResponse)

	emptyCollections := newFlowDefinitionFixture("empty-collections", userSchemaURI)
	emptyCollections.Audience.Value.AppIds = []string{}
	emptyCollections.Steps[1].Actions = []api.StepAction{}
	emptyCollections.Steps[1].Fields = []string{}
	createResp, err = client.CreateFlowDefinition(t.Context(), newCreateFlowDefinitionRequest(api.ProjectID(project.ID), emptyCollections))
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, createResp, helpers.MustMarshal(t, createResp))
	emptyCollectionsDef := createResp.(*api.FlowDefinitionResponse)

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
			name: "create response matches get for empty collections",
			req: api.GetFlowDefinitionParams{
				ID: emptyCollectionsDef.ID,
			},
			wantResp: emptyCollectionsDef,
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

const (
	// createdFlowDefinitions overruns the default page on purpose: a fixture
	// that fits in one page cannot tell a bounded list from an unbounded one.
	createdFlowDefinitions = 25
	// Creating a project seeds it with a default flow definition, so the
	// project holds one row more than the fixture loop creates.
	totalFlowDefinitions = createdFlowDefinitions + 1
	// Mirrors service.defaultListLimit, which is unexported.
	defaultFlowDefinitionPageSize = 20
)

func TestListFlowDefinitionsPagination(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	userSchemaURI := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)
	for i := range createdFlowDefinitions {
		resp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
			ProjectID: api.ProjectID(project.ID),
			FlowDefinition: api.FlowDefinition{
				Name:       fmt.Sprintf("paged-flow-%d", i),
				Status:     "active",
				UserSchema: userSchemaURI,
				Purposes:   map[string]string{"login": "step_1"},
				Steps:      validSteps(),
			},
		})
		require.NoError(t, err)
		require.IsType(t, &api.FlowDefinitionResponse{}, resp, helpers.MustMarshal(t, resp))
	}

	t.Run("happy", func(t *testing.T) {
		listFlowDefinitions := func(t *testing.T, params api.ListFlowDefinitionsParams) *api.FlowDefinitionListResponse {
			t.Helper()
			params.ProjectID = api.ProjectID(project.ID)
			res, err := client.ListFlowDefinitions(t.Context(), params)
			require.NoError(t, err)
			require.IsType(t, &api.FlowDefinitionListResponse{}, res, helpers.MustMarshal(t, res))
			return res.(*api.FlowDefinitionListResponse)
		}

		// A request that omits limit must bound its page at the server default
		// instead of returning every flow definition in the project.
		first := listFlowDefinitions(t, api.ListFlowDefinitionsParams{})
		require.Len(t, first.FlowDefinitions, defaultFlowDefinitionPageSize)
		firstToken, ok := first.NextPageToken.Get()
		require.True(t, ok, "a full page carries a cursor")

		// The remainder is shorter than a page, so it closes the walk.
		rest := listFlowDefinitions(t, api.ListFlowDefinitionsParams{
			PageToken: api.NewOptPageToken(firstToken),
		})
		require.Len(t, rest.FlowDefinitions, totalFlowDefinitions-defaultFlowDefinitionPageSize)
		assert.False(t, rest.NextPageToken.IsSet(), "a partial page ends the walk")

		wantIDs := make([]string, 0, totalFlowDefinitions)
		for _, page := range [][]api.FlowDefinitionResponse{first.FlowDefinitions, rest.FlowDefinitions} {
			for _, item := range page {
				wantIDs = append(wantIDs, item.ID)
			}
		}

		var gotIDs []string
		var pageToken api.OptPageToken
		for range totalFlowDefinitions {
			// iterate over all pages (with size one)
			page := listFlowDefinitions(t, api.ListFlowDefinitionsParams{
				Limit:     api.NewOptLimit(1),
				PageToken: pageToken,
			})
			require.Len(t, page.FlowDefinitions, 1)

			gotIDs = append(gotIDs, page.FlowDefinitions[0].ID)
			token, ok := page.NextPageToken.Get()
			require.True(t, ok, "a full page carries a cursor")
			pageToken = api.NewOptPageToken(token)
		}
		assert.Equal(t, wantIDs, gotIDs, "paging must cover the list in order, each row exactly once")

		// fetch the last page (with no next token)
		past := listFlowDefinitions(t, api.ListFlowDefinitionsParams{
			Limit:     api.NewOptLimit(1),
			PageToken: pageToken,
		})
		assert.Empty(t, past.FlowDefinitions)
		assert.False(t, past.NextPageToken.IsSet())
	})

	t.Run("malformed page token", func(t *testing.T) {
		res, err := client.ListFlowDefinitions(t.Context(), api.ListFlowDefinitionsParams{
			ProjectID: api.ProjectID(project.ID),
			PageToken: api.NewOptPageToken("not-a-cursor"),
		})
		require.NoError(t, err)
		// The operation declares its own 400, so the client hands back a bare
		// ErrorDetails: the decoded variant is what carries the status here.
		require.IsType(t, &api.ErrorDetails{}, res, helpers.MustMarshal(t, res))
		errRes := res.(*api.ErrorDetails)
		invalid := domain.ErrRequestInvalid()
		assert.Equal(t, api.ErrorCode(invalid.Code), errRes.Code)
		assert.Equal(t, invalid.Message, errRes.Message)
	})
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
	require.IsType(t, &api.FlowDefinitionResponse{}, resp1, helpers.MustMarshal(t, resp1))
	flowDef1 := resp1.(*api.FlowDefinitionResponse)

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
	require.IsType(t, &api.FlowDefinitionResponse{}, resp2, helpers.MustMarshal(t, resp2))
	flowDef2 := resp2.(*api.FlowDefinitionResponse)

	// A second revision of flow-1: same name, new id, created last.
	resp1b, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID: api.ProjectID(project1.ID),
		FlowDefinition: api.FlowDefinition{
			Name:       "flow-1",
			Status:     "active",
			UserSchema: userSchemaURI,
			Purposes:   map[string]string{"login": "step_1"},
			Steps:      validSteps(),
		},
	})
	require.IsType(t, &api.FlowDefinitionResponse{}, resp1b, helpers.MustMarshal(t, resp1b))
	flowDef1b := resp1b.(*api.FlowDefinitionResponse)
	require.NotEqual(t, flowDef1.ID, flowDef1b.ID)

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
	require.IsType(t, &api.FlowDefinitionResponse{}, resp3, helpers.MustMarshal(t, resp3))
	flowDef3 := resp3.(*api.FlowDefinitionResponse)

	tests := []struct {
		name    string
		project *domain.Project
		req     api.ListFlowDefinitionsParams
		// The server seeds default-login into every project; its id,
		// document and timestamps are not knowable here.
		wantDefault bool
		// Newest first, as documented; order is part of the contract.
		want []api.FlowDefinitionResponse
	}{
		{
			name:    "list all flow definitions in a project",
			project: project1,
			req: api.ListFlowDefinitionsParams{
				ProjectID: api.ProjectID(project1.ID),
			},
			wantDefault: true,
			want: []api.FlowDefinitionResponse{
				*flowDef1b,
				*flowDef2,
				*flowDef1,
			},
		},
		{
			name:    "list all flow definitions in project 2",
			project: project2,
			req: api.ListFlowDefinitionsParams{
				ProjectID: api.ProjectID(project2.ID),
			},
			wantDefault: true,
			want: []api.FlowDefinitionResponse{
				*flowDef3,
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
			wantDefault: false,
			want: []api.FlowDefinitionResponse{
				*flowDef2,
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
			wantDefault: true,
			want: []api.FlowDefinitionResponse{
				*flowDef1b,
				*flowDef1,
			},
		},
		{
			name:    "revisions of one flow, newest first",
			project: project1,
			req: api.ListFlowDefinitionsParams{
				ProjectID: api.ProjectID(project1.ID),
				Name:      api.NewOptString("flow-1"),
			},
			want: []api.FlowDefinitionResponse{
				*flowDef1b,
				*flowDef1,
			},
		},
		{
			name:    "name combined with a purpose the flow does not serve",
			project: project1,
			req: api.ListFlowDefinitionsParams{
				ProjectID: api.ProjectID(project1.ID),
				Name:      api.NewOptString("flow-1"),
				Purpose: api.OptListFlowDefinitionsPurpose{
					Value: "profiling",
					Set:   true,
				},
			},
		},
		{
			name:    "unknown name",
			project: project1,
			req: api.ListFlowDefinitionsParams{
				ProjectID: api.ProjectID(project1.ID),
				Name:      api.NewOptString("no-such-flow"),
			},
		},
		{
			name:    "only default flow definition",
			project: project3,
			req: api.ListFlowDefinitionsParams{
				ProjectID: api.ProjectID(project3.ID),
			},
			wantDefault: true,
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

			require.IsType(t, &api.FlowDefinitionListResponse{}, resp, helpers.MustMarshal(t, resp))
			actual := resp.(*api.FlowDefinitionListResponse)

			var others []api.FlowDefinitionResponse
			gotDefault := false
			for _, flowDef := range actual.FlowDefinitions {
				if flowDef.FlowDefinition.Name == "default-login" {
					gotDefault = true
					assert.Equal(t, tt.project.ID, flowDef.ProjectID)
					continue
				}
				others = append(others, flowDef)
			}
			assert.Equal(t, tt.wantDefault, gotDefault)
			// The list and the by-id read describe a flow definition the
			// same way (#939): document, purposes, audience, steps and
			// timestamps all match the create response.
			assert.Equal(t, tt.want, others)
		})
	}
}

// TestListFlowDefinitionsExpandUserSchema covers `expand=user_schema`
// (ADR 059 applied to a one-to-one relation): opt-in embedding of the flow's
// user schema as the same object GET /schemas/{id} returns, off the wire
// entirely when not requested, and orthogonal to pagination.
func TestListFlowDefinitionsExpandUserSchema(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	schemaURI := harness.CreateUserSchema(t, project, harness.EnsureTestData(t).Schemas.CreateSchemaRequestUserSchema)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	created, err := client.CreateFlowDefinition(t.Context(),
		newCreateFlowDefinitionRequest(api.ProjectID(project.ID), newFlowDefinitionFixture("expand-flow", schemaURI)))
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, created, helpers.MustMarshal(t, created))
	flowID := created.(*api.FlowDefinitionResponse).ID

	schemaRes, err := client.GetSchemaById(t.Context(), api.GetSchemaByIdParams{ID: schemaURI})
	require.NoError(t, err)
	require.IsType(t, &api.Schema{}, schemaRes, helpers.MustMarshal(t, schemaRes))
	wantSchema := *schemaRes.(*api.Schema)

	listFlows := func(t *testing.T, params api.ListFlowDefinitionsParams) *api.FlowDefinitionListResponse {
		t.Helper()
		res, err := client.ListFlowDefinitions(t.Context(), params)
		require.NoError(t, err)
		require.IsType(t, &api.FlowDefinitionListResponse{}, res, helpers.MustMarshal(t, res))
		return res.(*api.FlowDefinitionListResponse)
	}

	t.Run("expand embeds the sub-resource item", func(t *testing.T) {
		t.Parallel()
		list := listFlows(t, api.ListFlowDefinitionsParams{
			ProjectID: api.ProjectID(project.ID),
			Expand:    []api.FlowDefinitionExpand{api.FlowDefinitionExpandUserSchema},
		})
		require.NotEmpty(t, list.FlowDefinitions)
		var found bool
		for _, def := range list.FlowDefinitions {
			// Every row was asked for the expansion, and both the fixture's
			// schema and the seeded default-login's resolve.
			require.True(t, def.UserSchema.Set, helpers.MustMarshal(t, &def))
			require.False(t, def.UserSchema.Null, helpers.MustMarshal(t, &def))
			if def.ID == flowID {
				found = true
				assert.Equal(t, wantSchema, def.UserSchema.Value)
			}
		}
		require.True(t, found)
	})

	t.Run("no expand keeps the property off the wire", func(t *testing.T) {
		t.Parallel()
		list := listFlows(t, api.ListFlowDefinitionsParams{ProjectID: api.ProjectID(project.ID)})
		require.NotEmpty(t, list.FlowDefinitions)
		for _, def := range list.FlowDefinitions {
			assert.False(t, def.UserSchema.Set, helpers.MustMarshal(t, &def))
		}
	})

	t.Run("unknown expand value is rejected", func(t *testing.T) {
		t.Parallel()
		res, err := client.ListFlowDefinitions(t.Context(), api.ListFlowDefinitionsParams{
			ProjectID: api.ProjectID(project.ID),
			Expand:    []api.FlowDefinitionExpand{"teams"},
		})
		require.NoError(t, err)
		// The endpoint's 400 response is the bare error details; the matched
		// status branch implies the code path, so there is no wrapper to read
		// a StatusCode from.
		require.IsType(t, &api.ErrorDetails{}, res, helpers.MustMarshal(t, res))
		errRes := res.(*api.ErrorDetails)
		assert.Equal(t, api.ErrorCode(domain.ErrRequestInvalid().Code), errRes.Code)
	})

	// The single hydrate query in expandUserSchemas is complete only while a
	// flow page cannot reference more distinct schemas than one schema query
	// returns; this pins the flow page cap that guarantees it.
	t.Run("a flow page cannot outgrow one hydrate query", func(t *testing.T) {
		t.Parallel()
		res, err := client.ListFlowDefinitions(t.Context(), api.ListFlowDefinitionsParams{
			ProjectID: api.ProjectID(project.ID),
			Limit:     api.NewOptLimit(101),
			Expand:    []api.FlowDefinitionExpand{api.FlowDefinitionExpandUserSchema},
		})
		require.NoError(t, err)
		require.IsType(t, &api.ErrorDetails{}, res, helpers.MustMarshal(t, res))
		assert.Equal(t, api.ErrorCode(domain.ErrRequestInvalid().Code), res.(*api.ErrorDetails).Code)
	})

	t.Run("page token means the same with and without expand", func(t *testing.T) {
		t.Parallel()
		first := listFlows(t, api.ListFlowDefinitionsParams{
			ProjectID: api.ProjectID(project.ID),
			Limit:     api.NewOptLimit(1),
		})
		require.Len(t, first.FlowDefinitions, 1)
		token, ok := first.NextPageToken.Get()
		require.True(t, ok)

		second := listFlows(t, api.ListFlowDefinitionsParams{
			ProjectID: api.ProjectID(project.ID),
			Limit:     api.NewOptLimit(1),
			PageToken: api.NewOptPageToken(token),
			Expand:    []api.FlowDefinitionExpand{api.FlowDefinitionExpandUserSchema},
		})
		require.Len(t, second.FlowDefinitions, 1)
		assert.NotEqual(t, first.FlowDefinitions[0].ID, second.FlowDefinitions[0].ID)
		require.True(t, second.FlowDefinitions[0].UserSchema.Set, helpers.MustMarshal(t, second))
	})
}
