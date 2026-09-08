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

	update := func(t *testing.T, body api.UpdateVariablesRequest) api.UpdateVariablesRes {
		t.Helper()
		res, err := client.UpdateVariables(t.Context(), body, api.UpdateVariablesParams{
			ProjectID: projectID,
		})
		require.NoError(t, err)
		return res
	}
	get := func(t *testing.T) api.Variables {
		t.Helper()
		res, err := client.GetVariables(t.Context(), api.GetVariablesParams{
			ProjectID: projectID,
		})
		require.NoError(t, err)
		require.IsType(t, &api.Variables{}, res, helpers.MustMarshal(t, res))
		return *res.(*api.Variables)
	}

	t.Run("a bare scalar keeps its JSON type", func(t *testing.T) {
		res := update(t, api.UpdateVariablesRequest{
			"HOST":        api.NewVariableScalarVariableInput(api.NewStringVariableScalar("example.com")),
			"RETRY_COUNT": api.NewVariableScalarVariableInput(api.NewFloat64VariableScalar(10)),
			"VERBOSE":     api.NewVariableScalarVariableInput(api.NewBoolVariableScalar(true)),
		})
		require.IsType(t, &api.Variables{}, res, helpers.MustMarshal(t, res))

		vars := get(t)
		assert.Equal(t, api.NewVariableScalarVariable(api.NewStringVariableScalar("example.com")), vars["HOST"])
		assert.Equal(t, api.NewVariableScalarVariable(api.NewFloat64VariableScalar(10)), vars["RETRY_COUNT"])
		assert.Equal(t, api.NewVariableScalarVariable(api.NewBoolVariableScalar(true)), vars["VERBOSE"])
	})

	// A second write under a name the project already holds replaces the value
	// rather than adding a row beside it.
	t.Run("a rewrite replaces the value", func(t *testing.T) {
		update(t, api.UpdateVariablesRequest{
			"HOST": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("api.example.com")),
		})

		assert.Equal(t,
			api.NewVariableScalarVariable(api.NewStringVariableScalar("api.example.com")),
			get(t)["HOST"])
	})

	t.Run("a secret is reported as held and never returned", func(t *testing.T) {
		update(t, api.UpdateVariablesRequest{
			"GITHUB_CLIENT_SECRET": api.NewSecretVariableInputVariableInput(api.SecretVariableInput{
				Value:  api.NewStringVariableScalar("s3cr3t"),
				Secret: true,
			}),
		})

		held := api.NewSecretVariableVariable(api.SecretVariable{Secret: api.SecretVariableSecretTrue})
		assert.Equal(t, held, get(t)["GITHUB_CLIENT_SECRET"])

		// The ciphertext must not leak through the single-variable read either.
		res, err := client.GetVariable(t.Context(), api.GetVariableParams{
			ProjectID:    projectID,
			VariableName: "GITHUB_CLIENT_SECRET",
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
			ProjectID:    projectID,
			VariableName: "HOST",
		})
		require.NoError(t, err)
		require.IsType(t, &api.Variable{}, res, helpers.MustMarshal(t, res))
		assert.Equal(t,
			api.NewVariableScalarVariable(api.NewStringVariableScalar("api.example.com")),
			*res.(*api.Variable))
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

	// Deleting one name takes that name and nothing else: the others the same
	// owner entered are left standing.
	t.Run("deleting one name leaves the rest alone", func(t *testing.T) {
		res, err := client.DeleteVariable(t.Context(), api.DeleteVariableParams{
			ProjectID:    projectID,
			VariableName: "HOST",
		})
		require.NoError(t, err)
		require.IsType(t, &api.DeleteVariableNoContent{}, res, helpers.MustMarshal(t, res))

		vars := get(t)
		assert.NotContains(t, vars, "HOST")
		assert.Equal(t,
			api.NewVariableScalarVariable(api.NewFloat64VariableScalar(10)),
			vars["RETRY_COUNT"])

		// Deleting what is no longer there is a miss, not a silent success.
		res, err = client.DeleteVariable(t.Context(), api.DeleteVariableParams{
			ProjectID:    projectID,
			VariableName: "HOST",
		})
		require.NoError(t, err)
		status, code, _, ok := errorResponseParts(t, res)
		require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, res))
		assert.Equal(t, http.StatusNotFound, status)
		assert.Equal(t, domain.ErrVariableNotFound().Code, code)
	})

	// minProperties: 1 is in the contract, but ogen generates no check for it on
	// a map body, so without the handler's own guard an empty body would answer
	// 200 and change nothing — telling a client its update landed when it sent
	// none.
	t.Run("an empty body is rejected rather than silently doing nothing", func(t *testing.T) {
		res := update(t, api.UpdateVariablesRequest{})
		status, code, _, ok := errorResponseParts(t, res)
		require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, res))
		assert.Equal(t, http.StatusBadRequest, status)
		assert.Equal(t, domain.ErrRequestInvalid().Code, code)
	})

	// The pattern is in the contract for the path parameter, so a malformed
	// name is refused by the decoder there; in a body it is a map key, which no
	// schema constrains for ogen, so the handler has to check it. Either way the
	// body is applied whole or not at all, so the valid entry beside it must not
	// survive.
	t.Run("a malformed name is rejected and takes the whole body with it", func(t *testing.T) {
		res := update(t, api.UpdateVariablesRequest{
			"WOULD_HAVE_WORKED": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("x")),
			"not a name":        api.NewVariableScalarVariableInput(api.NewStringVariableScalar("x")),
		})
		status, code, _, ok := errorResponseParts(t, res)
		require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, res))
		assert.Equal(t, http.StatusBadRequest, status)
		assert.Equal(t, domain.ErrInvalidVariableName().Code, code)

		vars := get(t)
		assert.NotContains(t, vars, "not a name")
		assert.NotContains(t, vars, "WOULD_HAVE_WORKED",
			"a rejected body must leave the owner exactly as it was")
	})
}
