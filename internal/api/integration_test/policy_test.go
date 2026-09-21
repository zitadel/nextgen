//go:build postgres_integration || spanner_integration

package integration_test

import (
	"testing"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/api/integration_test/test_data"
	"github.com/zitadel/nextgen/internal/service"
)

// TestPolicies exercises the policy revision API (ADR 066) and its effect on
// the password gate: a published instance replaces the template defaults for
// the project.
func TestPolicies(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	params := api.CreatePolicyParams{ProjectID: api.ProjectID(project.ID)}
	document := func(config string) *api.Policy {
		return &api.Policy{
			Kind:      api.PolicyKindPolicy,
			Operation: "user.password.save",
			Config:    api.PolicyConfig{"min_length": jx.Raw(config)},
		}
	}

	t.Run("rejects a value below the template floor", func(t *testing.T) {
		resp, err := client.CreatePolicy(t.Context(), document("4"), params)
		require.NoError(t, err)
		bad, ok := resp.(*api.ErrorDetails)
		require.True(t, ok, "got %T: %s", resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("pol.invalid"), bad.Code)
	})

	t.Run("publishes, reads back, lists, and changes the password gate", func(t *testing.T) {
		created, err := client.CreatePolicy(t.Context(), document("8"), params)
		require.NoError(t, err)
		revision, ok := created.(*api.PolicyRevisionResponse)
		require.True(t, ok, "got %T: %s", created, helpers.MustMarshal(t, created))
		assert.NotEmpty(t, revision.ID)
		assert.Equal(t, "user.password.save", revision.Policy.Operation)
		assert.JSONEq(t, "8", string(revision.Policy.Config["min_length"]))

		got, err := client.GetPolicyById(t.Context(), api.GetPolicyByIdParams{ID: revision.ID})
		require.NoError(t, err)
		fetched, ok := got.(*api.PolicyRevisionResponse)
		require.True(t, ok, "got %T", got)
		assert.Equal(t, revision.ID, fetched.ID)

		listed, err := client.ListPolicies(t.Context(), api.ListPoliciesParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		list, ok := listed.(*api.ListPoliciesResponse)
		require.True(t, ok, "got %T", listed)
		require.NotEmpty(t, *list)
		assert.Equal(t, revision.ID, (*list)[0].ID)
		assert.Equal(t, "user.password.save", (*list)[0].Operation)

		// The template default is 15; the published instance lowers it to 8.
		user, err := harness.EnsureUserService(t).CreateUser(t.Context(), service.CreateUserInput{
			ProjectID:  project.ID,
			SchemaURL:  test_data.UserSchemaURL,
			Attributes: harness.EnsureTestData(t).Generator.GenerateUser(t, "policy.eight@example.com"),
		})
		require.NoError(t, err)
		set, err := client.SetUserPassword(t.Context(), &api.SetUserPasswordRequest{Password: "eightchr"},
			api.SetUserPasswordParams{UserID: api.UserID(user.ID)})
		require.NoError(t, err)
		assert.IsType(t, &api.SetUserPasswordNoContent{}, set, helpers.MustMarshal(t, set))

		// Seven characters is below the instance's floor.
		set, err = client.SetUserPassword(t.Context(), &api.SetUserPasswordRequest{Password: "sevench"},
			api.SetUserPasswordParams{UserID: api.UserID(user.ID)})
		require.NoError(t, err)
		bad, ok := set.(*api.SetUserPasswordBadRequest)
		require.True(t, ok, "got %T: %s", set, helpers.MustMarshal(t, set))
		assert.Equal(t, api.ErrorCode("user.password_policy_violation"), bad.Code)
	})
}
