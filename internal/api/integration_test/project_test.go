//go:build postgres_integration || spanner_integration

package integration_test

import (
	"cmp"
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
)

// actionNames returns the names of the given step actions in order, useful
// for assert.Contains checks now that Actions is an ordered slice.
func actionNames(actions []domain.FlowStepAction) []string {
	names := make([]string, len(actions))
	for i, a := range actions {
		names[i] = a.Name
	}
	return names
}

// stubFlowService satisfies [service.FlowService] while doing nothing.
type stubFlowService struct{}

func (stubFlowService) Resolve(_ context.Context, _ service.ResolveFlowRequest) (*domain.FlowDefinition, error) {
	return nil, nil
}

func (stubFlowService) Start(_ context.Context, _ service.StartFlowRequest) (domain.FlowStepResult, error) {
	return domain.FlowStepResult{}, nil
}

func (stubFlowService) Submit(_ context.Context, _ service.SubmitFlowRequest) (domain.FlowStepResult, error) {
	return domain.FlowStepResult{}, nil
}

func (stubFlowService) GetStep(_ context.Context, _ service.GetFlowStepRequest) (domain.FlowStepResult, error) {
	return domain.FlowStepResult{}, nil
}

// stubAuthAttemptService satisfies [service.AuthAttemptService] while doing nothing.
type stubAuthAttemptService struct{}

// Create implements [service.AuthAttemptService].
func (s *stubAuthAttemptService) Create(ctx context.Context, input service.CreateAuthAttemptInput) (*domain.AuthAttempt, error) {
	return nil, nil
}

// GetByID implements [service.AuthAttemptService].
func (s *stubAuthAttemptService) GetByID(ctx context.Context, projectID string, attemptID string) (*domain.AuthAttempt, error) {
	return nil, nil
}

// Handoff implements [service.AuthAttemptService].
func (s *stubAuthAttemptService) Handoff(ctx context.Context, input service.HandoffInput) (*domain.AuthAttempt, error) {
	return nil, nil
}

// IssueChallenge implements [service.AuthAttemptService].
func (s *stubAuthAttemptService) IssueChallenge(ctx context.Context, input service.IssueChallengeInput) (*domain.AuthAttempt, error) {
	return nil, nil
}

// VerifyProof implements [service.AuthAttemptService].
func (s *stubAuthAttemptService) VerifyProof(ctx context.Context, input service.VerifyProofInput) (*domain.AuthAttempt, error) {
	return nil, nil
}

func (s *stubAuthAttemptService) RegisterCreatedUser(ctx context.Context, projectID, attemptID, userID string) error {
	return nil
}

var _ service.AuthAttemptService = (*stubAuthAttemptService)(nil)

func TestCreateProject(t *testing.T) {
	t.Parallel()

	tcs := []struct {
		name string
		req  *api.CreateProjectRequest
	}{
		{
			name: "no optional fields",
			req: &api.CreateProjectRequest{
				Name:           helpers.ProjectName(),
				PreviewOrigins: make([]string, 0),
			},
		},
		{
			name: "with optional fields",
			req: &api.CreateProjectRequest{
				Name:           helpers.ProjectName(),
				PreviewOrigins: []string{"*.vercel.app", "*.netlify.app"},
			},
		},
	}

	for _, tc := range tcs {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
			require.NoError(t, err)

			resp, err := client.CreateProject(t.Context(), tc.req)
			require.NoError(t, err)

			got, ok := resp.(*api.CreateProjectResponse)
			require.True(t, ok, helpers.MustMarshal(t, resp))
			assert.NotEmpty(t, got.ID)
			assert.NotEmpty(t, got.ProjectSecret)
			assert.NotEmpty(t, got.PreviewSecret)
			assert.Equal(t, tc.req.PreviewOrigins, got.PreviewOrigins)
		})
	}
}

func TestCreateProjectProvisionsDefaultLoginFlow(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)
	schema, err := harness.EnsureSchemaStore(t).GetJSONSchemaByID(
		t.Context(),
		project.ID,
		schemaURL,
	)
	require.NoError(t, err)
	assert.Equal(t, schemaURL, schema.URL)

	listed, err := harness.EnsureServiceDB(t).Statements().ListFlowDefinitions(
		t.Context(),
		&v2database.ListOptions[domain.FlowDefinitionField]{
			Filter: v2database.And(
				v2database.Equal(v2database.Col(domain.FlowDefinitionFieldProjectID), project.ID),
				v2database.Equal(v2database.Col(domain.FlowDefinitionFieldName), "default-login"),
			),
		},
	)
	require.NoError(t, err)
	require.NotNil(t, listed)
	require.Len(t, listed.Items, 1)

	flowDef := listed.Items[0]
	assert.Equal(t, schemaURL, flowDef.UserSchema)
	assert.Equal(t, "identifier", flowDef.Purposes[domain.FlowDefinitionPurposeLogin])
	assert.Equal(t, "register", flowDef.Purposes[domain.FlowDefinitionPurposeRegister])

	identifierStep, ok := flowDef.FindStep("identifier")
	require.True(t, ok)
	assert.Contains(t, actionNames(identifierStep.Actions), domain.FlowActionPasskey)
	assert.Equal(t, "done", identifierStep.Transitions[domain.FlowActionPasskey].Target)

	passwordStep, ok := flowDef.FindStep("password")
	require.True(t, ok)
	assert.Equal(t, []domain.Field{"x-auth-methods#password"}, passwordStep.Fields)
	assert.Contains(t, actionNames(passwordStep.Actions), domain.FlowActionPasskey)
	assert.Equal(t, "done", passwordStep.Transitions[domain.FlowActionPasskey].Target)

	registerStep, ok := flowDef.FindStep("register")
	require.True(t, ok)
	assert.Equal(t, []domain.Field{"email"}, registerStep.Fields)
	assert.Contains(t, actionNames(registerStep.Actions), domain.FlowActionPasskeyRegister)
	assert.Equal(t, "done", registerStep.Transitions[domain.FlowActionPasskeyRegister].Target)

	registerPasswordStep, ok := flowDef.FindStep("register-password")
	require.True(t, ok)
	assert.Equal(t, []domain.Field{"x-auth-methods#password"}, registerPasswordStep.Fields)
	require.NotNil(t, registerPasswordStep.OnSuccess)
	assert.Equal(t, domain.FlowOnSuccessCreateUser, *registerPasswordStep.OnSuccess)
	// Registration completes directly — no passkey upsell step; passkey
	// registration is offered up front on the register step instead.
	assert.Equal(t, "done", registerPasswordStep.Transitions[domain.FlowActionSubmit].Target)

	_, ok = flowDef.FindStep("passkey-upsell")
	assert.False(t, ok)
}

func TestCreateProjectSkipsDefaultLoginFlow(t *testing.T) {
	t.Parallel()

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)

	resp, err := client.CreateProject(t.Context(), &api.CreateProjectRequest{
		Name:           helpers.ProjectName(),
		PreviewOrigins: make([]string, 0),
		SeedDefaults:   api.NewOptBool(false),
	})
	require.NoError(t, err)
	require.IsType(t, &api.CreateProjectResponse{}, resp, helpers.MustMarshal(t, resp))
	projectID := resp.(*api.CreateProjectResponse).ID

	schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)
	_, err = harness.EnsureSchemaStore(t).GetJSONSchemaByID(
		t.Context(),
		projectID,
		schemaURL,
	)
	require.Error(t, err)

	listed, err := harness.EnsureServiceDB(t).Statements().ListFlowDefinitions(
		t.Context(),
		&v2database.ListOptions[domain.FlowDefinitionField]{
			Filter: v2database.And(
				v2database.Equal(v2database.Col(domain.FlowDefinitionFieldProjectID), projectID),
				v2database.Equal(v2database.Col(domain.FlowDefinitionFieldName), "default-login"),
			),
		},
	)
	require.NoError(t, err)
	if listed != nil {
		assert.Empty(t, listed.Items)
	}
}

func TestGetProject(t *testing.T) {
	t.Parallel()

	previewOrigins := []string{"*.example.com", "localhost:3000"}
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), previewOrigins, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	notFound := domain.ErrProjectNotFound()

	tcs := []struct {
		name string
		// projectID targets a project other than the caller's own.
		projectID api.ProjectID
		want      api.GetProjectRes
	}{
		{
			name: "ok",
			want: &api.ProjectResponse{Name: project.Name, PreviewOrigins: previewOrigins},
		},
		{
			name:      "not found",
			projectID: "does_not_exist",
			want:      &api.GetProjectNotFound{Code: api.ErrorCode(notFound.Code), Message: notFound.Message},
		},
	}

	for _, tc := range tcs {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			resp, err := client.GetProject(t.Context(), api.GetProjectParams{
				ProjectID: cmp.Or(tc.projectID, api.ProjectID(project.ID)),
			})

			assert.NoError(t, err)
			assertProjectResponse(t, tc.want, resp)
		})
	}
}

func TestPatchProject(t *testing.T) {
	t.Parallel()

	foreign, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	var (
		renamed       = helpers.ProjectName()
		renamedKeep   = helpers.ProjectName()
		keptOrigins   = []string{"*.example.com", "localhost:3000"}
		nameInvalid   = domain.ErrProjectNameInvalid()
		notFound      = domain.ErrProjectNotFound()
		validRenameTo = &api.PatchProjectRequest{Name: api.NewOptNilString(helpers.ProjectName())}
	)

	tcs := []struct {
		name           string
		previewOrigins []string
		projectID      api.ProjectID
		req            *api.PatchProjectRequest
		want           api.PatchProjectRes
	}{
		{
			name: "rename",
			req:  &api.PatchProjectRequest{Name: api.NewOptNilString(renamed)},
			want: &api.ProjectResponse{Name: renamed, PreviewOrigins: []string{}},
		},
		{
			name:           "preview origins are left untouched",
			previewOrigins: keptOrigins,
			req:            &api.PatchProjectRequest{Name: api.NewOptNilString(renamedKeep)},
			want:           &api.ProjectResponse{Name: renamedKeep, PreviewOrigins: keptOrigins},
		},
		{
			name: "absent name",
			req:  &api.PatchProjectRequest{},
			want: &api.PatchProjectBadRequest{Code: api.ErrorCode(nameInvalid.Code), Message: nameInvalid.Message},
		},
		{
			name: "null name",
			req:  &api.PatchProjectRequest{Name: api.OptNilString{Set: true, Null: true}},
			want: &api.PatchProjectBadRequest{Code: api.ErrorCode(nameInvalid.Code), Message: nameInvalid.Message},
		},
		{
			name: "empty name",
			req:  &api.PatchProjectRequest{Name: api.NewOptNilString("")},
			want: &api.PatchProjectBadRequest{Code: api.ErrorCode(nameInvalid.Code), Message: nameInvalid.Message},
		},
		{
			name:      "nonexistent project",
			projectID: "does_not_exist",
			req:       validRenameTo,
			want:      &api.PatchProjectNotFound{Code: api.ErrorCode(notFound.Code), Message: notFound.Message},
		},
		{
			name:      "foreign project",
			projectID: api.ProjectID(foreign.ID),
			req:       validRenameTo,
			want:      &api.PatchProjectNotFound{Code: api.ErrorCode(notFound.Code), Message: notFound.Message},
		},
	}

	for _, tc := range tcs {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), tc.previewOrigins, true)
			require.NoError(t, err)

			client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
			require.NoError(t, err)
			harness.SetProjectSecretOnApiClient(t, client, project)

			projectID := cmp.Or(tc.projectID, api.ProjectID(project.ID))

			resp, err := client.PatchProject(t.Context(), tc.req,
				api.PatchProjectParams{ProjectID: projectID},
			)
			assert.NoError(t, err)
			assertProjectResponse(t, tc.want, resp)
		})
	}
}

// assertProjectResponse covers every operation answering with the shared
// project body: getProject, patchProject, and each item of queryProjects.
func assertProjectResponse(t *testing.T, want, got any) {
	t.Helper()
	if !assert.IsType(t, want, got, helpers.MustMarshal(t, got)) {
		return
	}

	switch expected := want.(type) {
	case *api.ProjectResponse:
		actual, ok := got.(*api.ProjectResponse)
		require.True(t, ok)

		assert.NotEmpty(t, actual.ID)
		assert.Equal(t, expected.Name, actual.Name)
		assert.Equal(t, expected.PreviewOrigins, actual.PreviewOrigins)
		assert.NotEmpty(t, actual.CreatedAt)
		assert.False(t, actual.UpdatedAt.Before(actual.CreatedAt))
	case *api.GetProjectNotFound:
		actual, ok := got.(*api.GetProjectNotFound)
		require.True(t, ok)

		assert.Equal(t, expected.Code, actual.Code)
		assert.Equal(t, expected.Message, actual.Message)
	case *api.PatchProjectBadRequest:
		actual, ok := got.(*api.PatchProjectBadRequest)
		require.True(t, ok)

		assert.Equal(t, expected.Code, actual.Code)
		assert.Equal(t, expected.Message, actual.Message)
	case *api.PatchProjectNotFound:
		actual, ok := got.(*api.PatchProjectNotFound)
		require.True(t, ok)

		assert.Equal(t, expected.Code, actual.Code)
		assert.Equal(t, expected.Message, actual.Message)
	default:
		assert.Fail(t, "unexpected response type", helpers.MustMarshal(t, got))
	}
}
