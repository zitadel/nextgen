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
		// One snapshot, several assertions: the point is what this read holds,
		// and re-reading between assertions would only be a second chance to
		// observe something different.
		vars := get(t, prod)
		assert.NotContains(t, vars, "RETRY_COUNT")
		assert.NotContains(t, vars, "VERBOSE")

		// And a sibling environment sees neither the project's nor prod's.
		staging := api.NewOptEnvironmentName("staging")
		assert.NotContains(t, get(t, staging), "HOST")
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

	// minProperties: 1 is in the contract, but ogen generates no check for it on
	// a map body, so without the handler's own guard an empty body would answer
	// 200 and change nothing — telling a client its update landed when it sent
	// none.
	t.Run("an empty body is rejected rather than silently doing nothing", func(t *testing.T) {
		res := update(t, api.OptEnvironmentName{}, api.UpdateVariablesRequest{})
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

	null := api.NewNullVariableInput(struct{}{})

	// The reason null-as-removal exists: several names go in one request, so a
	// caller tidying up does not have to walk them one DELETE at a time.
	t.Run("nulls remove several names in one request", func(t *testing.T) {
		update(t, api.OptEnvironmentName{}, api.UpdateVariablesRequest{
			"BULK_A": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("a")),
			"BULK_B": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("b")),
			"BULK_C": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("c")),
		})

		res := update(t, api.OptEnvironmentName{}, api.UpdateVariablesRequest{
			"BULK_A": null,
			"BULK_B": null,
		})
		require.IsType(t, &api.Variables{}, res, helpers.MustMarshal(t, res))
		// The response is the owner read back, so it already shows the removal.
		assert.NotContains(t, *res.(*api.Variables), "BULK_A")

		vars := get(t, api.OptEnvironmentName{})
		assert.NotContains(t, vars, "BULK_A")
		assert.NotContains(t, vars, "BULK_B")
		assert.Equal(t,
			api.NewVariableScalarVariable(api.NewStringVariableScalar("c")),
			vars["BULK_C"],
			"a name the body does not mention is untouched")
	})

	// One body, three fates: entered, replaced, removed. They share a
	// transaction, so this is one step for the caller rather than three.
	t.Run("one body enters, replaces and removes", func(t *testing.T) {
		update(t, api.OptEnvironmentName{}, api.UpdateVariablesRequest{
			"MIX_OLD":      api.NewVariableScalarVariableInput(api.NewStringVariableScalar("old")),
			"MIX_REPLACED": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("before")),
		})

		update(t, api.OptEnvironmentName{}, api.UpdateVariablesRequest{
			"MIX_NEW":      api.NewVariableScalarVariableInput(api.NewStringVariableScalar("new")),
			"MIX_REPLACED": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("after")),
			"MIX_OLD":      null,
		})

		vars := get(t, api.OptEnvironmentName{})
		assert.Equal(t, api.NewVariableScalarVariable(api.NewStringVariableScalar("new")), vars["MIX_NEW"])
		assert.Equal(t, api.NewVariableScalarVariable(api.NewStringVariableScalar("after")), vars["MIX_REPLACED"])
		assert.NotContains(t, vars, "MIX_OLD")
	})

	// The one place a patch differs from DELETE /variables/{name}, which
	// answers var.not_found: a patch states what the owner holds afterwards,
	// and a name that was never there already satisfies that. It is also what
	// makes a retry of the request above safe.
	t.Run("a null on a name the owner does not hold is not an error", func(t *testing.T) {
		res := update(t, api.OptEnvironmentName{}, api.UpdateVariablesRequest{
			"NEVER_ENTERED": null,
		})
		require.IsType(t, &api.Variables{}, res, helpers.MustMarshal(t, res))
		assert.NotContains(t, *res.(*api.Variables), "NEVER_ENTERED")
	})

	// A removal addresses one owner, the same way a write does.
	t.Run("a null removes only at the owner the request addresses", func(t *testing.T) {
		shared := api.UpdateVariablesRequest{
			"SHARED_NAME": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("kept")),
		}
		update(t, api.OptEnvironmentName{}, shared)
		update(t, prod, shared)

		update(t, prod, api.UpdateVariablesRequest{"SHARED_NAME": null})

		assert.NotContains(t, get(t, prod), "SHARED_NAME")
		assert.Equal(t,
			api.NewVariableScalarVariable(api.NewStringVariableScalar("kept")),
			get(t, api.OptEnvironmentName{})["SHARED_NAME"],
			"the project's value is untouched by an environment's removal")
	})

	// Secrets are the same resource, so they are removed the same way -- and
	// this is the removal that cannot be undone, since the value reads back
	// nowhere.
	t.Run("a null removes a secret too", func(t *testing.T) {
		update(t, prod, api.UpdateVariablesRequest{
			"DOOMED_SECRET": api.NewSecretVariableInputVariableInput(api.SecretVariableInput{
				Value:  api.NewStringVariableScalar("s3cr3t"),
				Secret: true,
			}),
		})
		require.Contains(t, get(t, prod), "DOOMED_SECRET")

		update(t, prod, api.UpdateVariablesRequest{"DOOMED_SECRET": null})
		assert.NotContains(t, get(t, prod), "DOOMED_SECRET")
	})

	// A removal is spelled with a name like any other entry, so it is held to
	// the same grammar -- and the body still lands whole or not at all.
	t.Run("a malformed name is rejected even when it is a removal", func(t *testing.T) {
		res := update(t, api.OptEnvironmentName{}, api.UpdateVariablesRequest{
			"WOULD_HAVE_WORKED_TOO": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("x")),
			"not a name":            null,
		})
		status, code, _, ok := errorResponseParts(t, res)
		require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, res))
		assert.Equal(t, http.StatusBadRequest, status)
		assert.Equal(t, domain.ErrInvalidVariableName().Code, code)

		assert.NotContains(t, get(t, api.OptEnvironmentName{}), "WOULD_HAVE_WORKED_TOO")
	})

	// A body of nothing but nulls is still a body: minProperties: 1 is about
	// the request naming something, not about it writing something.
	t.Run("a body of only nulls is accepted", func(t *testing.T) {
		update(t, api.OptEnvironmentName{}, api.UpdateVariablesRequest{
			"BULK_C": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("c")),
		})

		res := update(t, api.OptEnvironmentName{}, api.UpdateVariablesRequest{"BULK_C": null})
		require.IsType(t, &api.Variables{}, res, helpers.MustMarshal(t, res))
		assert.NotContains(t, get(t, api.OptEnvironmentName{}), "BULK_C")
	})
}
