//go:build postgres_integration || spanner_integration

package integration_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
)

// TestVariables covers the variables surface (ADR 061): that an owner reads and
// writes only what it entered itself, that a secret is held but never handed
// back, and that an owner can only delete its own.
func TestVariables(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	projectID := api.ProjectID(project.ID)
	prod := api.NewOptEnvironmentName("prod")

	update := func(t *testing.T, env api.OptEnvironmentName, body api.UpdateVariablesRequest) api.UpdateVariablesRes {
		t.Helper()
		res, err := client.UpdateVariables(t.Context(), body, api.UpdateVariablesParams{
			ProjectID:       projectID,
			EnvironmentName: env,
		})
		require.NoError(t, err)
		return res
	}
	get := func(t *testing.T, env api.OptEnvironmentName) api.Variables {
		t.Helper()
		res, err := client.GetVariables(t.Context(), api.GetVariablesParams{
			ProjectID:       projectID,
			EnvironmentName: env,
		})
		require.NoError(t, err)
		require.IsType(t, &api.Variables{}, res, helpers.MustMarshal(t, res))
		return *res.(*api.Variables)
	}

	t.Run("a bare scalar keeps its JSON type", func(t *testing.T) {
		res := update(t, api.OptEnvironmentName{}, api.UpdateVariablesRequest{
			"HOST":        api.NewVariableScalarVariableInput(api.NewStringVariableScalar("example.com")),
			"RETRY_COUNT": api.NewVariableScalarVariableInput(api.NewFloat64VariableScalar(10)),
			"VERBOSE":     api.NewVariableScalarVariableInput(api.NewBoolVariableScalar(true)),
		})
		require.IsType(t, &api.Variables{}, res, helpers.MustMarshal(t, res))

		vars := get(t, api.OptEnvironmentName{})
		assert.Equal(t, api.NewVariableScalarVariable(api.NewStringVariableScalar("example.com")), vars["HOST"])
		assert.Equal(t, api.NewVariableScalarVariable(api.NewFloat64VariableScalar(10)), vars["RETRY_COUNT"])
		assert.Equal(t, api.NewVariableScalarVariable(api.NewBoolVariableScalar(true)), vars["VERBOSE"])
	})

	// The two entries coexist and neither is visible from the other: an owner
	// is an address, not a position in a ladder.
	t.Run("the project and an environment hold the same name separately", func(t *testing.T) {
		update(t, prod, api.UpdateVariablesRequest{
			"HOST": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("prod.example.com")),
		})

		assert.Equal(t,
			api.NewVariableScalarVariable(api.NewStringVariableScalar("prod.example.com")),
			get(t, prod)["HOST"])
		assert.Equal(t,
			api.NewVariableScalarVariable(api.NewStringVariableScalar("example.com")),
			get(t, api.OptEnvironmentName{})["HOST"])
	})

	// Nothing is inherited: a value entered once on the project does not turn
	// up in an environment's read, so a name an environment needs is a name
	// that environment has to hold.
	t.Run("an environment does not inherit the project's variables", func(t *testing.T) {
		assert.NotContains(t, get(t, prod), "RETRY_COUNT")
		assert.NotContains(t, get(t, prod), "VERBOSE")

		// And the project level does not see into the environment either.
		staging := api.NewOptEnvironmentName("staging")
		assert.NotContains(t, get(t, staging), "HOST", "a sibling environment holds nothing yet")
	})

	t.Run("a secret is reported as held and never returned", func(t *testing.T) {
		update(t, prod, api.UpdateVariablesRequest{
			"GITHUB_CLIENT_SECRET": api.NewSecretVariableInputVariableInput(api.SecretVariableInput{
				Value:  api.NewStringVariableScalar("s3cr3t"),
				Secret: true,
			}),
		})

		held := api.NewSecretVariableVariable(api.SecretVariable{Secret: api.SecretVariableSecretTrue})
		assert.Equal(t, held, get(t, prod)["GITHUB_CLIENT_SECRET"])

		// The ciphertext must not leak through the single-variable read either.
		res, err := client.GetVariable(t.Context(), api.GetVariableParams{
			ProjectID:       projectID,
			VariableName:    "GITHUB_CLIENT_SECRET",
			EnvironmentName: prod,
		})
		require.NoError(t, err)
		require.IsType(t, &api.Variable{}, res, helpers.MustMarshal(t, res))
		assert.Equal(t, held, *res.(*api.Variable))
		assert.NotContains(t, helpers.MustMarshal(t, res), "s3cr3t")
	})

	// The single read addresses the same owner the list does, so the two can
	// never disagree about which value a name holds.
	t.Run("get by name reads the addressed owner", func(t *testing.T) {
		res, err := client.GetVariable(t.Context(), api.GetVariableParams{
			ProjectID:       projectID,
			VariableName:    "HOST",
			EnvironmentName: prod,
		})
		require.NoError(t, err)
		require.IsType(t, &api.Variable{}, res, helpers.MustMarshal(t, res))
		assert.Equal(t,
			api.NewVariableScalarVariable(api.NewStringVariableScalar("prod.example.com")),
			*res.(*api.Variable))

		// Same name, other owner, other value -- through the same endpoint.
		res, err = client.GetVariable(t.Context(), api.GetVariableParams{
			ProjectID:    projectID,
			VariableName: "HOST",
		})
		require.NoError(t, err)
		require.IsType(t, &api.Variable{}, res, helpers.MustMarshal(t, res))
		assert.Equal(t,
			api.NewVariableScalarVariable(api.NewStringVariableScalar("example.com")),
			*res.(*api.Variable))
	})

	// A name held only by the project is a miss from an environment: the read
	// half of what the delete case below proves for writes.
	t.Run("a name another owner holds is a 404 here", func(t *testing.T) {
		res, err := client.GetVariable(t.Context(), api.GetVariableParams{
			ProjectID:       projectID,
			VariableName:    "RETRY_COUNT",
			EnvironmentName: prod,
		})
		require.NoError(t, err)
		status, code, _, ok := errorResponseParts(t, res)
		require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, res))
		assert.Equal(t, http.StatusNotFound, status)
		assert.Equal(t, domain.ErrVariableNotFound().Code, code)
	})

	t.Run("a name nobody entered is a 404", func(t *testing.T) {
		res, err := client.GetVariable(t.Context(), api.GetVariableParams{
			ProjectID:    projectID,
			VariableName: "NOTHING_HERE",
		})
		require.NoError(t, err)
		status, code, _, ok := errorResponseParts(t, res)
		require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, res))
		assert.Equal(t, http.StatusNotFound, status)
		assert.Equal(t, domain.ErrVariableNotFound().Code, code)
	})

	// An environment did not enter the project's name, so it has nothing to
	// remove -- and the project's value is left standing.
	t.Run("an owner cannot delete a name another owner entered", func(t *testing.T) {
		res, err := client.DeleteVariable(t.Context(), api.DeleteVariableParams{
			ProjectID:       projectID,
			VariableName:    "RETRY_COUNT",
			EnvironmentName: prod,
		})
		require.NoError(t, err)
		status, code, _, ok := errorResponseParts(t, res)
		require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, res))
		assert.Equal(t, http.StatusNotFound, status)
		assert.Equal(t, domain.ErrVariableNotFound().Code, code)

		assert.Equal(t,
			api.NewVariableScalarVariable(api.NewFloat64VariableScalar(10)),
			get(t, api.OptEnvironmentName{})["RETRY_COUNT"])
	})

	t.Run("deleting an owner's own entry leaves the other owner's alone", func(t *testing.T) {
		res, err := client.DeleteVariable(t.Context(), api.DeleteVariableParams{
			ProjectID:       projectID,
			VariableName:    "HOST",
			EnvironmentName: prod,
		})
		require.NoError(t, err)
		require.IsType(t, &api.DeleteVariableNoContent{}, res, helpers.MustMarshal(t, res))

		assert.NotContains(t, get(t, prod), "HOST")
		assert.Equal(t,
			api.NewVariableScalarVariable(api.NewStringVariableScalar("example.com")),
			get(t, api.OptEnvironmentName{})["HOST"],
			"the project's value is untouched by an environment's delete")
	})

	// The pattern is in the contract for the path parameter, so a malformed
	// name is refused by the decoder there; in a body it is a map key, which no
	// schema constrains for ogen, so the handler has to check it. Either way the
	// body is applied whole or not at all, so the valid entry beside it must not
	// survive.
	t.Run("a malformed name is rejected and takes the whole body with it", func(t *testing.T) {
		res := update(t, api.OptEnvironmentName{}, api.UpdateVariablesRequest{
			"WOULD_HAVE_WORKED": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("x")),
			"not a name":        api.NewVariableScalarVariableInput(api.NewStringVariableScalar("x")),
		})
		status, code, _, ok := errorResponseParts(t, res)
		require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, res))
		assert.Equal(t, http.StatusBadRequest, status)
		assert.Equal(t, domain.ErrInvalidVariableName().Code, code)

		vars := get(t, api.OptEnvironmentName{})
		assert.NotContains(t, vars, "not a name")
		assert.NotContains(t, vars, "WOULD_HAVE_WORKED",
			"a rejected body must leave the owner exactly as it was")
	})
}
