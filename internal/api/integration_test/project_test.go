//go:build postgres_integration || spanner_integration

package integration_test

import (
	"cmp"
	"context"
	"strings"
	"testing"
	"time"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/passwap/argon2"
	"github.com/zitadel/passwap/bcrypt"
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

func (s *stubAuthAttemptService) BeginPasskeyEnrollment(context.Context, service.BeginPasskeyEnrollmentInput) (*service.BeginPasskeyEnrollmentOutput, error) {
	return nil, nil
}

func (s *stubAuthAttemptService) FinishPasskeyEnrollment(context.Context, service.FinishPasskeyEnrollmentInput) (*service.FinishPasskeyEnrollmentOutput, error) {
	return nil, nil
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

			require.IsType(t, &api.CreateProjectResponse{}, resp, helpers.MustMarshal(t, resp))
			got := resp.(*api.CreateProjectResponse)
			assert.NotEmpty(t, got.ID)
			assert.Equal(t, tc.req.Name, got.Name)
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
		service.WithAuthzListUnrestricted(t.Context()),
		&database.ListOptions[domain.FlowDefinitionField]{
			Filter: database.And(
				database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), project.ID),
				database.Equal(database.Col(domain.FlowDefinitionFieldName), "default-login"),
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
		service.WithAuthzListUnrestricted(t.Context()),
		&database.ListOptions[domain.FlowDefinitionField]{
			Filter: database.And(
				database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), projectID),
				database.Equal(database.Col(domain.FlowDefinitionFieldName), "default-login"),
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

// ADR 029 §Hashing: a project admin chooses the hashing method, so what a PATCH
// sets has to be what a later GET reads back, and null has to mean "back to the
// server default" rather than "leave it".
func TestPatchProjectPasswordHash(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	argon2id := api.PasswordHashPolicy{
		Algorithm: api.PasswordHashPolicyAlgorithmArgon2id,
		Params: api.PasswordHashPolicyParams{
			Time:    api.NewOptInt(1),
			Memory:  api.NewOptInt(32 * 1024),
			Threads: api.NewOptInt(1),
		},
	}

	t.Run("a new project reads back no method of its own", func(t *testing.T) {
		got, err := client.GetProject(t.Context(), api.GetProjectParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		response, ok := got.(*api.ProjectResponse)
		require.True(t, ok, helpers.MustMarshal(t, got))
		assert.True(t, response.PasswordHash.IsNull(), "no method chosen reads back as null")
	})

	t.Run("sets a method and reads it back", func(t *testing.T) {
		got, err := client.PatchProject(t.Context(), &api.PatchProjectRequest{
			PasswordHash: api.NewOptNilPasswordHashPolicy(argon2id),
		}, api.PatchProjectParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		patched, ok := got.(*api.ProjectResponse)
		require.True(t, ok, helpers.MustMarshal(t, got))

		policy, ok := patched.PasswordHash.Get()
		require.True(t, ok, helpers.MustMarshal(t, got))
		assert.Equal(t, api.PasswordHashPolicyAlgorithmArgon2id, policy.Algorithm)
		assert.Equal(t, api.NewOptInt(32*1024), policy.Params.Memory)

		read, err := client.GetProject(t.Context(), api.GetProjectParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		reread, ok := read.(*api.ProjectResponse)
		require.True(t, ok, helpers.MustMarshal(t, read))
		assert.Equal(t, patched.PasswordHash, reread.PasswordHash, "a GET reads back what the PATCH set")
	})

	t.Run("a rename leaves the method alone", func(t *testing.T) {
		got, err := client.PatchProject(t.Context(), &api.PatchProjectRequest{
			Name: api.NewOptNilString(helpers.ProjectName()),
		}, api.PatchProjectParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		renamed, ok := got.(*api.ProjectResponse)
		require.True(t, ok, helpers.MustMarshal(t, got))
		assert.False(t, renamed.PasswordHash.IsNull(), "a body that says nothing about hashing changes nothing")
	})

	t.Run("null gives the project back to the server default", func(t *testing.T) {
		got, err := client.PatchProject(t.Context(), &api.PatchProjectRequest{
			PasswordHash: api.OptNilPasswordHashPolicy{Set: true, Null: true},
		}, api.PatchProjectParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		cleared, ok := got.(*api.ProjectResponse)
		require.True(t, ok, helpers.MustMarshal(t, got))
		assert.True(t, cleared.PasswordHash.IsNull())
	})

	// The deployment's limits are the bar a project chooses inside. This
	// harness bounds bcrypt to 10..16, so cost 4 is refused, and it registers
	// no scrypt verifier, so scrypt is refused whatever it costs.
	t.Run("refuses a method the deployment would not take back", func(t *testing.T) {
		invalid := domain.ErrProjectPasswordHashInvalid()
		for name, policy := range map[string]api.PasswordHashPolicy{
			"cost below the limit": {
				Algorithm: api.PasswordHashPolicyAlgorithmBcrypt,
				Params:    api.PasswordHashPolicyParams{Cost: api.NewOptInt(4)},
			},
			"algorithm with no verifier": {
				Algorithm: api.PasswordHashPolicyAlgorithmScrypt,
				Params:    api.PasswordHashPolicyParams{Cost: api.NewOptInt(15)},
			},
			"parameters of another algorithm": {
				Algorithm: api.PasswordHashPolicyAlgorithmArgon2id,
				Params:    api.PasswordHashPolicyParams{Cost: api.NewOptInt(12)},
			},
		} {
			t.Run(name, func(t *testing.T) {
				got, err := client.PatchProject(t.Context(), &api.PatchProjectRequest{
					PasswordHash: api.NewOptNilPasswordHashPolicy(policy),
				}, api.PatchProjectParams{ProjectID: api.ProjectID(project.ID)})
				require.NoError(t, err)
				bad, ok := got.(*api.PatchProjectBadRequest)
				require.True(t, ok, helpers.MustMarshal(t, got))
				assert.Equal(t, api.ErrorCode(invalid.Code), bad.Code)
			})
		}
	})
}

// The acceptance criterion of #504: a project configured to hash with argon2id
// writes argon2id, while the deployment default keeps writing bcrypt, and both
// keep verifying.
func TestProjectPasswordHashPolicyGovernsHashing(t *testing.T) {
	t.Parallel()

	const password = "Passw0rd!-504"

	hashOf := func(t *testing.T, projectID, userID string) string {
		t.Helper()
		stored, err := harness.EnsureServiceDB(t).Statements().GetUserPassword(t.Context(), database.And(
			database.Equal(database.Col(domain.UserPasswordFieldProjectID), projectID),
			database.Equal(database.Col(domain.UserPasswordFieldUserID), userID),
		))
		require.NoError(t, err)
		return stored.EncodedHash
	}

	setPassword := func(t *testing.T, projectID string) (userID, encodedHash string) {
		t.Helper()
		userID = harness.CreateUserWithTeam(t, projectID)
		require.NoError(t, harness.EnsureUserService(t).SetPassword(t.Context(), service.SetPasswordInput{
			ProjectID: projectID,
			UserID:    userID,
			Password:  password,
		}))
		return userID, hashOf(t, projectID, userID)
	}

	deploymentDefault, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	ownMethod, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	policy, err := domain.NewPasswordHashPolicy("argon2id", map[string]any{
		"time": 1, "memory": 32 * 1024, "threads": 1,
	})
	require.NoError(t, err)
	_, err = harness.EnsureProjectService(t).Update(t.Context(), service.UpdateProjectRequest{
		ID:                 ownMethod.ID,
		PasswordHashPolicy: &policy,
	})
	require.NoError(t, err)

	_, defaultHash := setPassword(t, deploymentDefault.ID)
	ownUserID, ownHash := setPassword(t, ownMethod.ID)

	assert.True(t, strings.HasPrefix(defaultHash, bcrypt.Prefix),
		"a project with no method of its own writes the deployment's: %q", defaultHash)
	assert.True(t, strings.HasPrefix(ownHash, argon2.Prefix),
		"a project that chose argon2id writes argon2id: %q", ownHash)

	// Verification is deployment-wide and unchanged, which is what keeps a
	// password written under one method readable after the project picks
	// another.
	verifier := harness.EnsureHashVerifier(t)
	assert.NoError(t, verifier.VerifyHash(defaultHash, password))
	assert.NoError(t, verifier.VerifyHash(ownHash, password))

	// Handing the project back to the default moves the next password written,
	// not the one already stored.
	var cleared *domain.PasswordHashPolicy
	_, err = harness.EnsureProjectService(t).Update(t.Context(), service.UpdateProjectRequest{
		ID:                 ownMethod.ID,
		PasswordHashPolicy: &cleared,
	})
	require.NoError(t, err)

	assert.True(t, strings.HasPrefix(hashOf(t, ownMethod.ID, ownUserID), argon2.Prefix),
		"the stored hash is not rewritten by a policy change")
	_, afterClearing := setPassword(t, ownMethod.ID)
	assert.True(t, strings.HasPrefix(afterClearing, bcrypt.Prefix),
		"the next password written goes back to the deployment default")
}

func TestQueryProjects(t *testing.T) {
	t.Parallel()

	previewOrigins := []string{"*.example.com", "localhost:3000"}
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), previewOrigins, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	var (
		own            = api.ProjectResponse{Name: project.Name, PreviewOrigins: previewOrigins}
		requestInvalid = domain.ErrRequestInvalid()
		// A minute of slack absorbs the whole-second truncation RFC3339 applies.
		before = project.CreatedAt.Add(-time.Minute).Format(time.RFC3339)
		after  = project.CreatedAt.Add(time.Minute).Format(time.RFC3339)
	)

	createdAtFilter := func(op api.FilterOperation, value api.FilterValue) []api.QueryProjectsRequestFilterItem {
		return []api.QueryProjectsRequestFilterItem{{
			Field:     api.FilterFieldCreatedAt,
			Operation: op,
			Value:     api.NewOptFilterValue(value),
		}}
	}

	badRequest := func(details string) *api.QueryProjectsBadRequest {
		return &api.QueryProjectsBadRequest{
			Code:    api.ErrorCode(requestInvalid.Code),
			Message: requestInvalid.Message,
			Details: api.NewOptErrorDetailsDetails(api.ErrorDetailsDetails{
				"details": jx.Raw(helpers.MustMarshal(t, details)),
			}),
		}
	}

	tcs := []struct {
		name string
		req  *api.QueryProjectsRequest
		want api.QueryProjectsRes
	}{
		{
			name: "empty request returns the caller's project",
			req:  &api.QueryProjectsRequest{},
			want: &api.QueryProjectsResponse{Projects: []api.ProjectResponse{own}},
		},
		{
			name: "createdAt filter matches",
			req:  &api.QueryProjectsRequest{Filter: createdAtFilter(api.FilterOperationGreaterThan, api.NewStringFilterValue(before))},
			want: &api.QueryProjectsResponse{Projects: []api.ProjectResponse{own}},
		},
		{
			name: "createdAt filter excludes",
			req:  &api.QueryProjectsRequest{Filter: createdAtFilter(api.FilterOperationGreaterThan, api.NewStringFilterValue(after))},
			want: &api.QueryProjectsResponse{Projects: []api.ProjectResponse{}},
		},
		{
			name: "sorting",
			req: &api.QueryProjectsRequest{Sorting: api.NewOptQueryProjectsRequestSorting(api.QueryProjectsRequestSorting{
				Field:     api.FilterFieldCreatedAt,
				Direction: api.SortDirectionDesc,
			})},
			want: &api.QueryProjectsResponse{Projects: []api.ProjectResponse{own}},
		},
		{
			// A full page always carries a cursor: the store cannot know the
			// next one is empty without reading it.
			name: "limit fills the page",
			req:  &api.QueryProjectsRequest{Limit: api.NewOptLimit(1)},
			want: &api.QueryProjectsResponse{
				Projects:      []api.ProjectResponse{own},
				NextPageToken: api.NewOptNilPageToken("opaque, only its presence is asserted"),
			},
		},
		{
			name: "malformed page token",
			req:  &api.QueryProjectsRequest{PageToken: api.NewOptNilPageToken("not-a-cursor")},
			want: badRequest("invalid page token"),
		},
		{
			name: "filter value is not a timestamp",
			req:  &api.QueryProjectsRequest{Filter: createdAtFilter(api.FilterOperationEquals, api.NewStringFilterValue("yesterday"))},
			want: badRequest(`created_at filter value "yesterday" is not a valid RFC3339 timestamp`),
		},
		{
			name: "filter value is not a string",
			req:  &api.QueryProjectsRequest{Filter: createdAtFilter(api.FilterOperationEquals, api.NewBoolFilterValue(true))},
			want: badRequest("created_at filter value must be an RFC3339 string"),
		},
	}

	for _, tc := range tcs {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			resp, err := client.QueryProjects(t.Context(), tc.req)

			assert.NoError(t, err)
			assertProjectResponse(t, tc.want, resp)
		})
	}
}

func TestQueryProjectsPageTokenRoundTrip(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	req := &api.QueryProjectsRequest{Limit: api.NewOptLimit(1)}
	first, err := client.QueryProjects(t.Context(), req)
	require.NoError(t, err)
	require.IsType(t, &api.QueryProjectsResponse{}, first, helpers.MustMarshal(t, first))
	firstPage := first.(*api.QueryProjectsResponse)
	require.Len(t, firstPage.Projects, 1)

	pageToken, ok := firstPage.NextPageToken.Get()
	require.True(t, ok, "a full page carries a cursor")

	req.PageToken = api.NewOptNilPageToken(pageToken)
	second, err := client.QueryProjects(t.Context(), req)
	require.NoError(t, err)
	require.IsType(t, &api.QueryProjectsResponse{}, second, helpers.MustMarshal(t, second))
	secondPage := second.(*api.QueryProjectsResponse)
	assert.Empty(t, secondPage.Projects)
	assert.False(t, secondPage.NextPageToken.IsSet())
}

// TestQueryProjectsPageTokenRequiresMatchingSorting proves that page tokens
// validate OrderBy: a DESC page-1 token fails when page 2 omits sorting (default
// ASC), and succeeds when the same DESC sorting is repeated.
func TestQueryProjectsPageTokenRequiresMatchingSorting(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	sorting := api.NewOptQueryProjectsRequestSorting(api.QueryProjectsRequestSorting{
		Field:     api.FilterFieldCreatedAt,
		Direction: api.SortDirectionDesc,
	})
	first, err := client.QueryProjects(t.Context(), &api.QueryProjectsRequest{
		Limit:   api.NewOptLimit(1),
		Sorting: sorting,
	})
	require.NoError(t, err)
	require.IsType(t, &api.QueryProjectsResponse{}, first, helpers.MustMarshal(t, first))
	firstPage := first.(*api.QueryProjectsResponse)
	require.Len(t, firstPage.Projects, 1)
	pageToken, ok := firstPage.NextPageToken.Get()
	require.True(t, ok, "a full page carries a cursor")

	mismatch, err := client.QueryProjects(t.Context(), &api.QueryProjectsRequest{
		Limit:     api.NewOptLimit(1),
		PageToken: api.NewOptNilPageToken(pageToken),
	})
	require.NoError(t, err)
	require.IsType(t, &api.QueryProjectsBadRequest{}, mismatch, helpers.MustMarshal(t, mismatch))
	requestInvalid := domain.ErrRequestInvalid()
	assertProjectResponse(t, &api.QueryProjectsBadRequest{
		Code:    api.ErrorCode(requestInvalid.Code),
		Message: requestInvalid.Message,
		Details: api.NewOptErrorDetailsDetails(api.ErrorDetailsDetails{
			"details": jx.Raw(helpers.MustMarshal(t, "page token does not match the requested sorting")),
		}),
	}, mismatch)

	matched, err := client.QueryProjects(t.Context(), &api.QueryProjectsRequest{
		Limit:     api.NewOptLimit(1),
		PageToken: api.NewOptNilPageToken(pageToken),
		Sorting:   sorting,
	})
	require.NoError(t, err)
	require.IsType(t, &api.QueryProjectsResponse{}, matched, helpers.MustMarshal(t, matched))
	matchedPage := matched.(*api.QueryProjectsResponse)
	assert.Empty(t, matchedPage.Projects)
	assert.False(t, matchedPage.NextPageToken.IsSet())
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
		require.IsType(t, &api.ProjectResponse{}, got, helpers.MustMarshal(t, got))
		actual := got.(*api.ProjectResponse)

		assert.NotEmpty(t, actual.ID)
		assert.Equal(t, expected.Name, actual.Name)
		assert.Equal(t, expected.PreviewOrigins, actual.PreviewOrigins)
		assert.NotEmpty(t, actual.CreatedAt)
		assert.False(t, actual.UpdatedAt.Before(actual.CreatedAt))
	case *api.QueryProjectsResponse:
		require.IsType(t, &api.QueryProjectsResponse{}, got, helpers.MustMarshal(t, got))
		actual := got.(*api.QueryProjectsResponse)

		if !assert.Len(t, actual.Projects, len(expected.Projects), helpers.MustMarshal(t, got)) {
			return
		}
		for i := range expected.Projects {
			assertProjectResponse(t, &expected.Projects[i], &actual.Projects[i])
		}
		// The token is an opaque cursor; only whether a next page exists is
		// worth pinning.
		assert.Equal(t, expected.NextPageToken.IsSet(), actual.NextPageToken.IsSet())
	case *api.QueryProjectsBadRequest:
		require.IsType(t, &api.QueryProjectsBadRequest{}, got, helpers.MustMarshal(t, got))
		actual := got.(*api.QueryProjectsBadRequest)

		assert.Equal(t, expected.Code, actual.Code)
		assert.Equal(t, expected.Message, actual.Message)
		assert.Equal(t, expected.Details, actual.Details)
	case *api.GetProjectNotFound:
		require.IsType(t, &api.GetProjectNotFound{}, got, helpers.MustMarshal(t, got))
		actual := got.(*api.GetProjectNotFound)

		assert.Equal(t, expected.Code, actual.Code)
		assert.Equal(t, expected.Message, actual.Message)
	case *api.PatchProjectBadRequest:
		require.IsType(t, &api.PatchProjectBadRequest{}, got, helpers.MustMarshal(t, got))
		actual := got.(*api.PatchProjectBadRequest)

		assert.Equal(t, expected.Code, actual.Code)
		assert.Equal(t, expected.Message, actual.Message)
	case *api.PatchProjectNotFound:
		require.IsType(t, &api.PatchProjectNotFound{}, got, helpers.MustMarshal(t, got))
		actual := got.(*api.PatchProjectNotFound)

		assert.Equal(t, expected.Code, actual.Code)
		assert.Equal(t, expected.Message, actual.Message)
	default:
		assert.Fail(t, "unexpected response type", helpers.MustMarshal(t, got))
	}
}
