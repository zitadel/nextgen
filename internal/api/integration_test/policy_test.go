//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/api/integration_test/test_data"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const passwordSetOperation = "auth.factor.password.set"

func publishPolicy(t *testing.T, client *helpers.ApiClient, projectID string, config api.PasswordSetConfig) api.PublishPolicyRes {
	t.Helper()
	resp, err := client.PublishPolicy(t.Context(), api.NewPasswordSetPolicyInputPublishPolicyRequest(api.PasswordSetPolicyInput{
		Operation: api.PasswordSetPolicyInputOperationAuthFactorPasswordSet,
		Config:    config,
	}), api.PublishPolicyParams{ProjectID: api.ProjectID(projectID)})
	require.NoError(t, err)
	return resp
}

// passwordSetPolicy unwraps a password policy from a policy response.
func passwordSetPolicy(t *testing.T, resp any) api.PasswordSetPolicy {
	t.Helper()
	require.IsType(t, &api.Policy{}, resp, helpers.MustMarshal(t, resp))
	policy, ok := resp.(*api.Policy).GetPasswordSetPolicy()
	require.True(t, ok, helpers.MustMarshal(t, resp))
	return policy
}

// publishRawPolicy posts a body the typed client cannot build and returns
// the status and the error code.
func publishRawPolicy(t *testing.T, token, projectID, body string) (int, api.ErrorCode) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
		harness.APIBaseURL(t)+"/policies?project_id="+url.QueryEscape(projectID),
		strings.NewReader(body),
	)
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := harness.EnsureHttpClient(t).Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return resp.StatusCode, helpers.MustUnmarshal[api.ErrorDetails](t, raw).Code
}

// TestPolicies covers publishing a policy and reading it back: by id, in the
// list and through its revisions (ADR 066, ADR 063).
func TestPolicies(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	deployPrimary(t, project.ID)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	rev1 := passwordSetPolicy(t, publishPolicy(t, client, project.ID, api.PasswordSetConfig{MinLength: api.NewOptInt(12)}))
	assert.True(t, strings.HasPrefix(string(rev1.ID), "pol_"))
	assert.True(t, strings.HasPrefix(string(rev1.RevisionID), "polrev_"))
	assert.Equal(t, api.PasswordSetPolicyOperationAuthFactorPasswordSet, rev1.Operation)
	assert.Equal(t, api.PasswordSetConfig{MinLength: api.NewOptInt(12)}, rev1.Config)
	assert.True(t, rev1.CreatedAt.Equal(rev1.UpdatedAt))

	rev2 := passwordSetPolicy(t, publishPolicy(t, client, project.ID,
		api.PasswordSetConfig{MinLength: api.NewOptInt(15), HistoryDepth: api.NewOptInt(4)}))
	assert.Equal(t, rev1.ID, rev2.ID, "a project has one policy per operation")
	assert.NotEqual(t, rev1.RevisionID, rev2.RevisionID)
	assert.True(t, rev2.CreatedAt.Equal(rev1.CreatedAt))
	assert.False(t, rev2.UpdatedAt.Before(rev1.UpdatedAt))

	t.Run("an older revision stays readable", func(t *testing.T) {
		resp, err := client.GetPolicyRevision(t.Context(), api.GetPolicyRevisionParams{
			ProjectID:  api.ProjectID(project.ID),
			RevisionID: rev1.RevisionID,
		})
		require.NoError(t, err)
		got := passwordSetPolicy(t, resp)
		assert.Equal(t, rev1.RevisionID, got.RevisionID)
		assert.Equal(t, api.PasswordSetConfig{MinLength: api.NewOptInt(12)}, got.Config,
			"a setting the revision left out stays out")
	})

	t.Run("a config outside the typed request is malformed", func(t *testing.T) {
		for name, config := range map[string]string{
			"below the bound":    `{"min_length": 0}`,
			"unknown setting":    `{"min_lenght": 12}`,
			"not an integer":     `{"min_length": "12"}`,
			"history above four": `{"history_depth": 5}`,
		} {
			t.Run(name, func(t *testing.T) {
				status, code := publishRawPolicy(t, client.Token(), project.ID,
					`{"operation": "auth.factor.password.set", "config": `+config+`}`)
				assert.Equal(t, http.StatusBadRequest, status)
				assert.Equal(t, api.ErrorCode("req.invalid"), code)
			})
		}
	})

	t.Run("an unknown operation is malformed", func(t *testing.T) {
		status, code := publishRawPolicy(t, client.Token(), project.ID,
			`{"operation": "auth.factor.passkey.enroll", "config": {}}`)
		assert.Equal(t, http.StatusBadRequest, status)
		assert.Equal(t, api.ErrorCode("req.invalid"), code)
	})

	t.Run("contradicting settings fail the template", func(t *testing.T) {
		resp := publishPolicy(t, client, project.ID, api.PasswordSetConfig{MinLength: api.NewOptInt(20), MaxLength: api.NewOptInt(10)})
		require.IsType(t, &api.PublishPolicyErrorResponseStatusCode{}, resp, helpers.MustMarshal(t, resp))
		denied := resp.(*api.PublishPolicyErrorResponseStatusCode)
		assert.Equal(t, http.StatusBadRequest, denied.StatusCode)
		assert.True(t, denied.Response.IsPolInvalid(), helpers.MustMarshal(t, resp))
		details, ok := denied.Response.PolInvalid.Details.Get()
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.JSONEq(t, `{"violations": [
			{"config_rule": "min_length_not_above_max_length", "settings": ["max_length", "min_length"]}
		]}`, string(details["details"]), "the details name the rule and the settings it reads")
	})

	t.Run("the policy reads at its newest revision", func(t *testing.T) {
		resp, err := client.GetPolicy(t.Context(), api.GetPolicyParams{ProjectID: api.ProjectID(project.ID), PolicyID: rev1.ID})
		require.NoError(t, err)
		got := passwordSetPolicy(t, resp)
		assert.Equal(t, rev2.RevisionID, got.RevisionID)
		assert.Equal(t, rev2.Config, got.Config)
	})

	t.Run("the list holds each policy at its newest revision", func(t *testing.T) {
		resp, err := client.ListPolicies(t.Context(), api.ListPoliciesParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		require.IsType(t, &api.ListPoliciesResponse{}, resp, helpers.MustMarshal(t, resp))
		list := resp.(*api.ListPoliciesResponse)
		require.Len(t, list.Policies, 1)
		assert.Equal(t, rev2.RevisionID, passwordSetPolicy(t, &list.Policies[0]).RevisionID)
		assert.False(t, list.NextPageToken.Set)

		resp, err = client.ListPolicies(t.Context(), api.ListPoliciesParams{
			ProjectID: api.ProjectID(project.ID),
			Operation: api.NewOptPolicyOperation(api.PolicyOperation(passwordSetOperation)),
		})
		require.NoError(t, err)
		require.IsType(t, &api.ListPoliciesResponse{}, resp, helpers.MustMarshal(t, resp))
		assert.Len(t, resp.(*api.ListPoliciesResponse).Policies, 1, "the operation filter keeps the operation's policy")
	})

	t.Run("a project without a policy lists none", func(t *testing.T) {
		empty, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		deployPrimary(t, empty.ID)
		emptyClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, emptyClient, empty)

		resp, err := emptyClient.ListPolicies(t.Context(), api.ListPoliciesParams{ProjectID: api.ProjectID(empty.ID)})
		require.NoError(t, err)
		require.IsType(t, &api.ListPoliciesResponse{}, resp, helpers.MustMarshal(t, resp))
		assert.Empty(t, resp.(*api.ListPoliciesResponse).Policies)
	})

	t.Run("the revisions page newest first", func(t *testing.T) {
		list := func(token api.OptPageToken) *api.ListPolicyRevisionsResponse {
			t.Helper()
			resp, err := client.ListPolicyRevisions(t.Context(), api.ListPolicyRevisionsParams{
				ProjectID: api.ProjectID(project.ID),
				PolicyID:  rev1.ID,
				Limit:     api.NewOptLimit(1),
				PageToken: token,
			})
			require.NoError(t, err)
			require.IsType(t, &api.ListPolicyRevisionsResponse{}, resp, helpers.MustMarshal(t, resp))
			return resp.(*api.ListPolicyRevisionsResponse)
		}
		first := list(api.OptPageToken{})
		require.Len(t, first.Revisions, 1)
		assert.Equal(t, rev2.RevisionID, passwordSetPolicy(t, &first.Revisions[0]).RevisionID)
		token, ok := first.NextPageToken.Get()
		require.True(t, ok, "a full page carries a token")

		second := list(api.NewOptPageToken(token))
		require.Len(t, second.Revisions, 1)
		assert.Equal(t, rev1.RevisionID, passwordSetPolicy(t, &second.Revisions[0]).RevisionID)
		assert.Equal(t, api.PasswordSetConfig{MinLength: api.NewOptInt(12)}, passwordSetPolicy(t, &second.Revisions[0]).Config)
	})

	t.Run("an unknown policy is not found", func(t *testing.T) {
		resp, err := client.GetPolicy(t.Context(), api.GetPolicyParams{ProjectID: api.ProjectID(project.ID), PolicyID: "pol_unknown"})
		require.NoError(t, err)
		require.IsType(t, &api.GetPolicyErrorResponseStatusCode{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, http.StatusNotFound, resp.(*api.GetPolicyErrorResponseStatusCode).StatusCode)

		revisions, err := client.ListPolicyRevisions(t.Context(), api.ListPolicyRevisionsParams{ProjectID: api.ProjectID(project.ID), PolicyID: "pol_unknown"})
		require.NoError(t, err)
		require.IsType(t, &api.ListPolicyRevisionsErrorResponseStatusCode{}, revisions, helpers.MustMarshal(t, revisions))
		notFound := revisions.(*api.ListPolicyRevisionsErrorResponseStatusCode)
		assert.Equal(t, http.StatusNotFound, notFound.StatusCode)
		assert.True(t, notFound.Response.IsPolNotFound(), "not an empty page")
	})

	t.Run("another project's credentials cannot publish", func(t *testing.T) {
		other, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		deployPrimary(t, other.ID)
		otherClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, otherClient, other)

		// Project B's secret, project A's id: a weaker policy for A must not
		// land. To B, project A does not exist, so the write is refused the way
		// schemas, flows, users and branding refuse it.
		resp := publishPolicy(t, otherClient, project.ID, api.PasswordSetConfig{MinLength: api.NewOptInt(1)})
		require.IsType(t, &api.PublishPolicyErrorResponseStatusCode{}, resp, helpers.MustMarshal(t, resp))
		denied := resp.(*api.PublishPolicyErrorResponseStatusCode)
		assert.Equal(t, http.StatusBadRequest, denied.StatusCode, helpers.MustMarshal(t, resp))
		assert.True(t, denied.Response.IsPolInvalid(), helpers.MustMarshal(t, resp))
		assert.Contains(t, denied.Response.PolInvalid.Message, "project does not exist")

		newest, err := harness.EnsurePolicyService(t).ResolvePolicy(t.Context(), project.ID, passwordSetOperation)
		require.NoError(t, err)
		require.NotNil(t, newest)
		assert.Equal(t, json.Number("15"), newest.Config["min_length"], "project A's policy is unchanged")
	})

	t.Run("a revision of another project is not found", func(t *testing.T) {
		other, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		deployPrimary(t, other.ID)
		otherClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, otherClient, other)

		resp, err := otherClient.GetPolicyRevision(t.Context(), api.GetPolicyRevisionParams{
			ProjectID:  api.ProjectID(other.ID),
			RevisionID: rev1.RevisionID,
		})
		require.NoError(t, err)
		require.IsType(t, &api.GetPolicyRevisionErrorResponseStatusCode{}, resp, helpers.MustMarshal(t, resp))
		notFound := resp.(*api.GetPolicyRevisionErrorResponseStatusCode)
		assert.Equal(t, http.StatusNotFound, notFound.StatusCode)
		assert.True(t, notFound.Response.IsPolNotFound())
	})

	t.Run("the project's own credentials naming another project get not found", func(t *testing.T) {
		other, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		deployPrimary(t, other.ID)

		for name, projectID := range map[string]string{"another project": other.ID, "an unknown project": "proj_unknown"} {
			t.Run(name, func(t *testing.T) {
				resp, err := client.GetPolicy(t.Context(), api.GetPolicyParams{ProjectID: api.ProjectID(projectID), PolicyID: rev1.ID})
				require.NoError(t, err)
				require.IsType(t, &api.GetPolicyErrorResponseStatusCode{}, resp, helpers.MustMarshal(t, resp))
				notFound := resp.(*api.GetPolicyErrorResponseStatusCode)
				assert.Equal(t, http.StatusNotFound, notFound.StatusCode)
				assert.True(t, notFound.Response.IsPolNotFound())

				revisions, err := client.ListPolicyRevisions(t.Context(), api.ListPolicyRevisionsParams{ProjectID: api.ProjectID(projectID), PolicyID: rev1.ID})
				require.NoError(t, err)
				require.IsType(t, &api.ListPolicyRevisionsErrorResponseStatusCode{}, revisions, helpers.MustMarshal(t, revisions))
				assert.Equal(t, http.StatusNotFound, revisions.(*api.ListPolicyRevisionsErrorResponseStatusCode).StatusCode)
			})
		}
	})

	t.Run("a policy of another project is not found", func(t *testing.T) {
		other, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		deployPrimary(t, other.ID)
		otherClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, otherClient, other)

		resp, err := otherClient.GetPolicy(t.Context(), api.GetPolicyParams{ProjectID: api.ProjectID(other.ID), PolicyID: rev1.ID})
		require.NoError(t, err)
		require.IsType(t, &api.GetPolicyErrorResponseStatusCode{}, resp, helpers.MustMarshal(t, resp))
		notFound := resp.(*api.GetPolicyErrorResponseStatusCode)
		assert.Equal(t, http.StatusNotFound, notFound.StatusCode)
		assert.True(t, notFound.Response.IsPolNotFound())

		revisions, err := otherClient.ListPolicyRevisions(t.Context(), api.ListPolicyRevisionsParams{ProjectID: api.ProjectID(other.ID), PolicyID: rev1.ID})
		require.NoError(t, err)
		require.IsType(t, &api.ListPolicyRevisionsErrorResponseStatusCode{}, revisions, helpers.MustMarshal(t, revisions))
		assert.Equal(t, http.StatusNotFound, revisions.(*api.ListPolicyRevisionsErrorResponseStatusCode).StatusCode)

		list, err := otherClient.ListPolicies(t.Context(), api.ListPoliciesParams{ProjectID: api.ProjectID(other.ID)})
		require.NoError(t, err)
		require.IsType(t, &api.ListPoliciesResponse{}, list, helpers.MustMarshal(t, list))
		assert.Empty(t, list.(*api.ListPoliciesResponse).Policies)
	})
}

// TestPasswordPolicyEnforced publishes a password policy over the API and
// checks the gate applies it everywhere a password is set: the admin API and
// registration.
func TestPasswordPolicyEnforced(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	deployPrimary(t, project.ID)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	passwordSetPolicy(t, publishPolicy(t, client, project.ID, api.PasswordSetConfig{MinLength: api.NewOptInt(12)}))

	t.Run("admin API", func(t *testing.T) {
		user, err := harness.EnsureUserService(t).CreateUser(t.Context(), service.CreateUserInput{
			ProjectID:  project.ID,
			SchemaURL:  test_data.UserSchemaURL,
			Attributes: harness.EnsureTestData(t).Generator.GenerateUser(t, "policy.enforced@example.com"),
		})
		require.NoError(t, err)
		params := api.SetUserPasswordParams{UserID: api.UserID(user.ID)}

		resp, err := client.SetUserPassword(t.Context(), &api.SetUserPasswordRequest{Password: "short-pass"}, params)
		require.NoError(t, err)
		require.IsType(t, &api.SetUserPasswordBadRequest{}, resp, helpers.MustMarshal(t, resp))
		body := resp.(*api.SetUserPasswordBadRequest)
		assert.Equal(t, domain.ErrUserPasswordPolicyViolation(nil).Code, string(body.Code))
		assert.JSONEq(t, `{"violations":{"min_length":12}}`, string(body.Details.Value["details"]))

		resp, err = client.SetUserPassword(t.Context(), &api.SetUserPasswordRequest{Password: "a-long-enough-password"}, params)
		require.NoError(t, err)
		assert.IsType(t, &api.SetUserPasswordNoContent{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("registration", func(t *testing.T) {
		schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)
		defResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
			ProjectID:      api.ProjectID(project.ID),
			FlowDefinition: passwordRegisterFlowDefinition(schemaURL),
		})
		require.NoError(t, err)
		require.IsType(t, &api.FlowDefinitionResponse{}, defResp)

		createResp, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{
			ProjectID: api.ProjectID(project.ID),
			Purpose:   api.CreateFlowRequestPurposeRegister,
		}, api.CreateFlowParams{})
		require.NoError(t, err)
		require.IsType(t, &api.FlowResponseHeaders{}, createResp, helpers.MustMarshal(t, createResp))
		flowHeaders := createResp.(*api.FlowResponseHeaders)

		// The step that sets the password shows the policy's bounds, with the
		// cap as the maximum the policy leaves unset.
		var shown api.FieldValidation
		for _, f := range flowHeaders.Response.Step.Fields {
			if f.Name == "x-auth-methods#password" {
				shown = f.Validation.Or(api.FieldValidation{})
			}
		}
		assert.Equal(t, api.NewOptInt(12), shown.MinLength)
		assert.Equal(t, api.NewOptInt(domain.MaxPasswordLength), shown.MaxLength)

		// Ten characters are refused on the step that collects them.
		submitResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
			Action: "submit",
			Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{
				"email":                   jx.Raw(`"policy-register@example.com"`),
				"x-auth-methods#password": jx.Raw(`"short-pass"`),
			}),
		}, api.SubmitFlowStepParams{ID: flowHeaders.Response.ID, Zflow: mustExtractZflow(t, flowHeaders.SetCookie)})
		require.NoError(t, err)
		require.IsType(t, &api.SubmitFlowStepBadRequest{}, submitResp, helpers.MustMarshal(t, submitResp))
		badResp := submitResp.(*api.SubmitFlowStepBadRequest)
		errVal, errSet := badResp.Response.Step.Error.Get()
		require.True(t, errSet)
		assert.Equal(t, "error.x-auth-methods#password_min_length", errVal)
	})
}

// TestPasswordPolicyFollowsTheRelease runs register flows the way a browser on
// the project's origin does, so each resolves the release deployed there, and
// reads the minimum the password step shows, which comes from the same
// resolver the gate uses.
func TestPasswordPolicyFollowsTheRelease(t *testing.T) {
	t.Parallel()

	const origin = "https://policy.acme.test"
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	deployPrimary(t, project.ID)
	_, err = harness.EnsureProjectService(t).AddOrigin(t.Context(), project.ID, domain.Origin{Pattern: origin, Kind: domain.OriginKindPrimary})
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	deploy := func(t *testing.T, policies ...api.PublishPolicyRequest) {
		t.Helper()
		built, err := client.BuildRelease(t.Context(), &api.BuildReleaseRequest{
			Bundle: api.ConfigurationBundle{
				FlowDefinitions: []api.FlowDefinition{passwordRegisterFlowDefinition("human-user")},
				Policies:        policies,
			},
		}, api.BuildReleaseParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		var releaseID api.ReleaseID
		switch r := built.(type) {
		case *api.BuildReleaseCreated:
			releaseID = r.ID
		case *api.BuildReleaseOK:
			releaseID = r.ID
		default:
			require.Fail(t, "build refused", helpers.MustMarshal(t, built))
		}
		resp, err := client.CreateDeployment(t.Context(), &api.CreateDeploymentRequest{
			ReleaseID: api.NewOptReleaseID(releaseID),
			Targets:   api.DeploymentTargetsRequest{"primary"},
		}, api.CreateDeploymentParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		switch resp.(type) {
		case *api.CreateDeploymentCreated, *api.CreateDeploymentOK:
		default:
			require.Fail(t, "deploy refused", helpers.MustMarshal(t, resp))
		}
	}
	// shownMinimum opens a register flow from from ("" for none) and returns
	// the minimum its password step shows, 0 without a policy.
	shownMinimum := func(t *testing.T, from string) int {
		t.Helper()
		body, err := json.Marshal(map[string]string{"project_id": project.ID, "purpose": "register"})
		require.NoError(t, err)
		resp, raw := postFlow(t, "/flow", body, from, nil)
		require.Equal(t, http.StatusCreated, resp.StatusCode, string(raw))
		var opened api.FlowResponse
		require.NoError(t, opened.UnmarshalJSON(raw), string(raw))
		for _, field := range opened.Step.Fields {
			if field.Name == "x-auth-methods#password" {
				return field.Validation.Or(api.FieldValidation{}).MinLength.Or(0)
			}
		}
		require.Fail(t, "no password field", string(raw))
		return 0
	}
	minimum := func(n int) api.PublishPolicyRequest {
		return passwordPolicyRequest(api.PasswordSetConfig{MinLength: api.NewOptInt(n)})
	}

	deploy(t, minimum(12))
	assert.Equal(t, 12, shownMinimum(t, origin), "the deployed release's policy applies")

	// Building without deploying, or publishing on the side, changes the
	// newest revision but not what the deployed release serves.
	_, err = client.BuildRelease(t.Context(), &api.BuildReleaseRequest{
		Bundle: api.ConfigurationBundle{
			FlowDefinitions: []api.FlowDefinition{passwordRegisterFlowDefinition("human-user")},
			Policies:        []api.PublishPolicyRequest{minimum(16)},
		},
	}, api.BuildReleaseParams{ProjectID: api.ProjectID(project.ID)})
	require.NoError(t, err)
	passwordSetPolicy(t, publishPolicy(t, client, project.ID, api.PasswordSetConfig{MinLength: api.NewOptInt(20)}))
	assert.Equal(t, 12, shownMinimum(t, origin), "a release that was only built does not apply")
	assert.Equal(t, 12, shownMinimum(t, ""), "a caller with no origin runs the newest primary deployment")

	deploy(t)
	assert.Equal(t, 0, shownMinimum(t, origin), "a release without the policy means no policy, not the newest")

	deploy(t, minimum(12))
	assert.Equal(t, 12, shownMinimum(t, origin), "deploying it again brings it back")
}

func evaluatePasswordPolicy(t *testing.T, client *helpers.ApiClient, projectID string, config api.PasswordSetConfig, password string, facts api.OptPasswordSetEvaluateFacts) api.EvaluatePolicyRes {
	t.Helper()
	resp, err := client.EvaluatePolicy(t.Context(), api.NewPasswordSetEvaluateRequestEvaluatePolicyRequest(api.PasswordSetEvaluateRequest{
		Operation: api.PasswordSetEvaluateRequestOperationAuthFactorPasswordSet,
		Config:    config,
		Input:     api.PasswordSetEvaluateInput{Password: password},
		Facts:     facts,
	}), api.EvaluatePolicyParams{ProjectID: api.ProjectID(projectID)})
	require.NoError(t, err)
	return resp
}

// TestEvaluatePolicy covers the dry run: it answers what a password set would,
// in the live error's terms, and stores nothing (ADR 066, #1445).
func TestEvaluatePolicy(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	config := api.PasswordSetConfig{MinLength: api.NewOptInt(12), HistoryDepth: api.NewOptInt(2)}

	decision := func(t *testing.T, resp api.EvaluatePolicyRes) *api.EvaluatePolicyResponse {
		t.Helper()
		require.IsType(t, &api.EvaluatePolicyResponse{}, resp, helpers.MustMarshal(t, resp))
		return resp.(*api.EvaluatePolicyResponse)
	}

	t.Run("allowed", func(t *testing.T) {
		got := decision(t, evaluatePasswordPolicy(t, client, project.ID, config, "a-long-enough-one", api.OptPasswordSetEvaluateFacts{}))
		assert.True(t, got.Allowed)
		assert.False(t, got.Code.IsSet())
		assert.False(t, got.Violations.IsSet())
	})

	t.Run("refused with the live code and violations", func(t *testing.T) {
		got := decision(t, evaluatePasswordPolicy(t, client, project.ID, config, "short1", api.OptPasswordSetEvaluateFacts{}))
		assert.False(t, got.Allowed)
		assert.Equal(t, "user.password_policy_violation", got.Code.Or(""))
		violations, ok := got.Violations.Get()
		require.True(t, ok)
		assert.JSONEq(t, `12`, string(violations["min_length"]))
	})

	t.Run("the stated history counts for a user's own set", func(t *testing.T) {
		facts := api.NewOptPasswordSetEvaluateFacts(api.PasswordSetEvaluateFacts{HistoryMatches: []bool{false, true}})
		got := decision(t, evaluatePasswordPolicy(t, client, project.ID, config, "a-long-enough-one", facts))
		assert.False(t, got.Allowed)
		violations, _ := got.Violations.Get()
		assert.Contains(t, violations, "history_depth")
	})

	t.Run("an empty password answers the live guard", func(t *testing.T) {
		got := decision(t, evaluatePasswordPolicy(t, client, project.ID, config, "", api.OptPasswordSetEvaluateFacts{}))
		assert.False(t, got.Allowed)
		assert.Equal(t, "user.password_empty", got.Code.Or(""))
	})

	t.Run("an invalid config is refused as a publish refuses it", func(t *testing.T) {
		resp := evaluatePasswordPolicy(t, client, project.ID,
			api.PasswordSetConfig{MinLength: api.NewOptInt(20), MaxLength: api.NewOptInt(10)}, "x", api.OptPasswordSetEvaluateFacts{})
		require.IsType(t, &api.EvaluatePolicyErrorResponseStatusCode{}, resp, helpers.MustMarshal(t, resp))
		denied := resp.(*api.EvaluatePolicyErrorResponseStatusCode)
		assert.Equal(t, http.StatusBadRequest, denied.StatusCode)
		assert.True(t, denied.Response.IsPolInvalid(), helpers.MustMarshal(t, resp))
	})

	t.Run("an oversized body is refused before evaluating", func(t *testing.T) {
		for name, req := range map[string]api.PasswordSetEvaluateRequest{
			"a password above 4096 characters": {Input: api.PasswordSetEvaluateInput{Password: strings.Repeat("a", 4097)}},
			"more history than any depth reads": {
				Input: api.PasswordSetEvaluateInput{Password: "x"},
				Facts: api.NewOptPasswordSetEvaluateFacts(api.PasswordSetEvaluateFacts{HistoryMatches: make([]bool, 5)}),
			},
		} {
			t.Run(name, func(t *testing.T) {
				req.Operation = api.PasswordSetEvaluateRequestOperationAuthFactorPasswordSet
				req.Config = config
				_, err := client.EvaluatePolicy(t.Context(), api.NewPasswordSetEvaluateRequestEvaluatePolicyRequest(req), api.EvaluatePolicyParams{ProjectID: api.ProjectID(project.ID)})
				// The generated client validates its own request, so the bound
				// is part of the contract both sides read.
				require.Error(t, err)
			})
		}
	})

	t.Run("nothing is stored", func(t *testing.T) {
		resp, err := client.ListPolicies(t.Context(), api.ListPoliciesParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		require.IsType(t, &api.ListPoliciesResponse{}, resp, helpers.MustMarshal(t, resp))
		assert.Empty(t, resp.(*api.ListPoliciesResponse).Policies)
	})
}
