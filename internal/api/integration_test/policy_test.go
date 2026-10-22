//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/json"
	"net/http"
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

func publishPolicy(t *testing.T, client *helpers.ApiClient, projectID string, config map[string]string) api.PublishPolicyRes {
	t.Helper()
	cfg := make(api.PublishPolicyRequestConfig, len(config))
	for name, raw := range config {
		cfg[name] = jx.Raw(raw)
	}
	resp, err := client.PublishPolicy(t.Context(), &api.PublishPolicyRequest{
		Operation: passwordSetOperation,
		Config:    cfg,
	}, api.PublishPolicyParams{ProjectID: api.ProjectID(projectID)})
	require.NoError(t, err)
	return resp
}

// TestPolicies covers publishing a policy and reading revisions back
// (ADR 066, ADR 063).
func TestPolicies(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	first := publishPolicy(t, client, project.ID, map[string]string{"min_length": "12"})
	require.IsType(t, &api.Policy{}, first, helpers.MustMarshal(t, first))
	rev1 := first.(*api.Policy)
	assert.True(t, strings.HasPrefix(string(rev1.ID), "pol_"))
	assert.True(t, strings.HasPrefix(string(rev1.RevisionID), "polrev_"))
	assert.Equal(t, passwordSetOperation, rev1.Operation)
	assert.JSONEq(t, "12", string(rev1.Config["min_length"]))
	assert.True(t, rev1.CreatedAt.Equal(rev1.UpdatedAt))

	second := publishPolicy(t, client, project.ID, map[string]string{"min_length": "15", "history_depth": "4"})
	require.IsType(t, &api.Policy{}, second, helpers.MustMarshal(t, second))
	rev2 := second.(*api.Policy)
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
		require.IsType(t, &api.Policy{}, resp, helpers.MustMarshal(t, resp))
		got := resp.(*api.Policy)
		assert.Equal(t, rev1.RevisionID, got.RevisionID)
		assert.JSONEq(t, "12", string(got.Config["min_length"]))
		assert.NotContains(t, got.Config, "history_depth")
	})

	t.Run("invalid configs are refused", func(t *testing.T) {
		for name, config := range map[string]map[string]string{
			"below the bound":    {"min_length": "0"},
			"unknown setting":    {"min_lenght": "12"},
			"min above max":      {"min_length": "20", "max_length": "10"},
			"not an integer":     {"min_length": `"12"`},
			"history above four": {"history_depth": "5"},
		} {
			t.Run(name, func(t *testing.T) {
				resp := publishPolicy(t, client, project.ID, config)
				require.IsType(t, &api.PublishPolicyErrorResponseStatusCode{}, resp, helpers.MustMarshal(t, resp))
				denied := resp.(*api.PublishPolicyErrorResponseStatusCode)
				assert.Equal(t, http.StatusBadRequest, denied.StatusCode)
				assert.True(t, denied.Response.IsPolInvalid(), helpers.MustMarshal(t, resp))
			})
		}
	})

	t.Run("an unknown operation is refused", func(t *testing.T) {
		resp, err := client.PublishPolicy(t.Context(), &api.PublishPolicyRequest{
			Operation: "auth.factor.passkey.enroll",
			Config:    api.PublishPolicyRequestConfig{},
		}, api.PublishPolicyParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		require.IsType(t, &api.PublishPolicyErrorResponseStatusCode{}, resp, helpers.MustMarshal(t, resp))
		assert.True(t, resp.(*api.PublishPolicyErrorResponseStatusCode).Response.IsPolInvalid())
	})

	t.Run("another project's credentials cannot publish", func(t *testing.T) {
		other, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		otherClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, otherClient, other)

		// Project B's secret, project A's id: a weaker policy for A must not
		// land. To B, project A does not exist, so the write is refused the way
		// schemas, flows, users and branding refuse it.
		resp := publishPolicy(t, otherClient, project.ID, map[string]string{"min_length": "1"})
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
}

// TestPasswordPolicyEnforced publishes a password policy over the API and
// checks the gate applies it everywhere a password is set: the admin API and
// registration.
func TestPasswordPolicyEnforced(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	published := publishPolicy(t, client, project.ID, map[string]string{"min_length": "12"})
	require.IsType(t, &api.Policy{}, published, helpers.MustMarshal(t, published))

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

		// Ten characters pass the flow field's own minimum of 8 and are
		// refused by the project's policy.
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
