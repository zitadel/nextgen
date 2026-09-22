//go:build postgres_integration || spanner_integration

package integration_test

import (
	"io"
	"net/http"
	"strings"
	"testing"

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
	document := func(minLength int) api.Policy {
		return api.NewPolicyUserPasswordSavePolicy(api.PolicyUserPasswordSave{
			Kind:      api.PolicyUserPasswordSaveKindPolicy,
			Operation: api.PolicyUserPasswordSaveOperationUserPasswordSave,
			Config:    api.PolicyUserPasswordSaveConfig{MinLength: api.NewOptInt(minLength)},
		})
	}

	t.Run("rejects a value below the template floor", func(t *testing.T) {
		// The wire schema carries the template's bounds, so the generated
		// client refuses this body before sending it; the raw request shows
		// the server refuses it too.
		body := helpers.MustMarshal(t, map[string]any{
			"kind":      "policy",
			"operation": "user.password.save",
			"config":    map[string]any{"min_length": 4},
		})
		req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
			harness.EnsureTestServer(t).URL+"/policies?project_id="+project.ID, strings.NewReader(body))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+harness.ProjectSecret(t, project))

		resp, err := harness.EnsureHttpClient(t).Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		answer, err := io.ReadAll(resp.Body)
		require.NoError(t, err)

		// Structural validation (the schema's `minimum`) answers first, as
		// req.invalid; the template check behind it is the same bound.
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode, string(answer))
		assert.Contains(t, string(answer), `"code":"req.invalid"`)
	})

	t.Run("publishes, reads back, lists, and changes the password gate", func(t *testing.T) {
		created, err := client.CreatePolicy(t.Context(), document(8), params)
		require.NoError(t, err)
		revision, ok := created.(*api.PolicyRevisionResponse)
		require.True(t, ok, "got %T: %s", created, helpers.MustMarshal(t, created))
		assert.NotEmpty(t, revision.ID)
		assert.Equal(t, api.PolicyUserPasswordSavePolicy, revision.Policy.Type)
		assert.Equal(t, 8, revision.Policy.PolicyUserPasswordSave.Config.MinLength.Value)

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
