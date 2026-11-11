//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"net/http"
	"testing"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "go.zitadel.com/zitadel/v5/api"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
)

// TestUserCreatePolicy covers the sign-up policy end to end (ADR 088 §5): it
// publishes and reads back like any policy, refuses a challenge the server
// cannot issue, allows the built-in proof of work in a dry run, and a sign-up
// under it solves the same challenge as one without it.
func TestUserCreatePolicy(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	config := api.UserCreateConfig{Challenge: api.NewOptUserCreateConfigChallenge(api.UserCreateConfigChallengeZitadelPow)}

	resp, err := client.PublishPolicy(t.Context(), api.NewUserCreatePolicyInputPublishPolicyRequest(api.UserCreatePolicyInput{
		Operation: api.UserCreatePolicyInputOperationUserCreate,
		Config:    config,
	}), api.PublishPolicyParams{ProjectID: api.ProjectID(project.ID)})
	require.NoError(t, err)
	published := userCreatePolicy(t, resp)
	assert.Equal(t, api.UserCreatePolicyOperationUserCreate, published.Operation)
	assert.Equal(t, config, published.Config)

	t.Run("reads back typed by its operation", func(t *testing.T) {
		resp, err := client.GetPolicyRevision(t.Context(), api.GetPolicyRevisionParams{
			ProjectID:  api.ProjectID(project.ID),
			RevisionID: published.RevisionID,
		})
		require.NoError(t, err)
		assert.Equal(t, config, userCreatePolicy(t, resp).Config)
	})

	t.Run("a challenge the server cannot issue is malformed", func(t *testing.T) {
		status, code := publishRawPolicy(t, client.Token(), project.ID,
			`{"operation": "user.create", "config": {"challenge": "turnstile"}}`)
		assert.Equal(t, http.StatusBadRequest, status)
		assert.Equal(t, api.ErrorCode("req.invalid"), code)
	})

	t.Run("a dry run allows the built-in proof of work", func(t *testing.T) {
		resp, err := client.EvaluatePolicy(t.Context(), api.NewUserCreateEvaluateRequestEvaluatePolicyRequest(api.UserCreateEvaluateRequest{
			Operation: api.UserCreateEvaluateRequestOperationUserCreate,
			Config:    config,
			Input:     api.UserCreateEvaluateInput{SolvedChallenge: api.UserCreateEvaluateInputSolvedChallengeZitadelPow},
		}), api.EvaluatePolicyParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		require.IsType(t, &api.EvaluatePolicyResponse{}, resp, helpers.MustMarshal(t, resp))
		assert.True(t, resp.(*api.EvaluatePolicyResponse).Allowed)
	})

	t.Run("a sign-up under the policy solves the built-in proof of work", func(t *testing.T) {
		def, err := client.PublishFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{ProjectID: api.ProjectID(project.ID), FlowDefinition: combinedPasswordFlowDefinition(defaultSchemaURL())})
		require.NoError(t, err)
		require.IsType(t, &api.FlowDefinitionResponse{}, def)
		// The release pins the flow and the published policy, so the sign-up
		// resolves the policy rather than none.
		deployPrimary(t, project.ID)
		started, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{ProjectID: api.ProjectID(project.ID), Purpose: api.CreateFlowRequestPurposeLogin}, api.CreateFlowParams{})
		require.NoError(t, err)
		require.IsType(t, &api.FlowResponseHeaders{}, started)
		start := started.(*api.FlowResponseHeaders)
		email := api.FlowSubmitRequestFields{"email": jx.Raw(`"policy-signup@example.com"`)}
		switched := mustSubmitOK(t, client, start.Response.ID, mustExtractZflow(t, start.SetCookie), "register", email)
		step := mustSubmitOK(t, client, start.Response.ID, mustExtractZflow(t, switched.SetCookie), "submit", email)
		require.Equal(t, "register-password", step.Response.Step.Name)
		cookie := mustExtractZflow(t, step.SetCookie)
		done, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
			Action:     "submit",
			Fields:     api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{"x-auth-methods#password": jx.Raw(`"correct-horse-battery-staple"`)}),
			GateProofs: currentSignupProofs(t, client, start.Response.ID, cookie),
		}, api.SubmitFlowStepParams{FlowID: start.Response.ID, Zflow: cookie})
		require.NoError(t, err)
		require.IsType(t, &api.SubmitFlowStepOK{}, done, helpers.MustMarshal(t, done))
		assert.Equal(t, "done", done.(*api.SubmitFlowStepOK).Response.Step.Name)
	})
}

// userCreatePolicy unwraps a sign-up policy from a policy response.
func userCreatePolicy(t *testing.T, resp any) api.UserCreatePolicy {
	t.Helper()
	require.IsType(t, &api.Policy{}, resp, helpers.MustMarshal(t, resp))
	policy, ok := resp.(*api.Policy).GetUserCreatePolicy()
	require.True(t, ok, helpers.MustMarshal(t, resp))
	return policy
}
