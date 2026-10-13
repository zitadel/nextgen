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

// TestVariables covers the variables surface (ADR 062): that a project reads
// and writes its variables, and that a secret is held but never handed back.
func TestVariables(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	projectID := api.ProjectID(project.ID)
	update := func(t *testing.T, kind api.OptVariableKind, body api.UpdateVariablesRequest) api.UpdateVariablesRes {
		t.Helper()
		res, err := client.UpdateVariables(t.Context(), body, api.UpdateVariablesParams{
			ProjectID: projectID,
			Kind:      kind,
		})
		require.NoError(t, err)
		return res
	}
	// get reads the primary values, keyed by name.
	get := func(t *testing.T, kind api.OptVariableKind) map[string]api.Variable {
		t.Helper()
		res, err := client.GetVariables(t.Context(), api.GetVariablesParams{
			ProjectID: projectID,
			Kind:      kind,
		})
		require.NoError(t, err)
		require.IsType(t, &api.VariablesByKind{}, res, helpers.MustMarshal(t, res))
		return primaryValues(*res.(*api.VariablesByKind))
	}

	t.Run("a bare scalar keeps its JSON type", func(t *testing.T) {
		res := update(t, api.OptVariableKind{}, api.UpdateVariablesRequest{
			"HOST":        api.NewVariableScalarVariableInput(api.NewStringVariableScalar("example.com")),
			"RETRY_COUNT": api.NewVariableScalarVariableInput(api.NewFloat64VariableScalar(10)),
			"VERBOSE":     api.NewVariableScalarVariableInput(api.NewBoolVariableScalar(true)),
		})
		require.IsType(t, &api.VariablesByKind{}, res, helpers.MustMarshal(t, res))

		vars := get(t, api.OptVariableKind{})
		assert.Equal(t, api.NewVariableScalarVariable(api.NewStringVariableScalar("example.com")), vars["HOST"])
		assert.Equal(t, api.NewVariableScalarVariable(api.NewFloat64VariableScalar(10)), vars["RETRY_COUNT"])
		assert.Equal(t, api.NewVariableScalarVariable(api.NewBoolVariableScalar(true)), vars["VERBOSE"])
	})

	t.Run("a secret is reported as held and never returned", func(t *testing.T) {
		update(t, api.OptVariableKind{}, api.UpdateVariablesRequest{
			"GITHUB_CLIENT_SECRET": api.NewSecretVariableInputVariableInput(api.SecretVariableInput{
				Value:  api.NewStringVariableScalar("s3cr3t"),
				Secret: true,
			}),
		})

		held := api.NewSecretVariableVariable(api.SecretVariable{Secret: true})
		assert.Equal(t, held, get(t, api.OptVariableKind{})["GITHUB_CLIENT_SECRET"])

		// The ciphertext must not leak through the single-variable read either.
		res, err := client.GetVariable(t.Context(), api.GetVariableParams{
			ProjectID:    projectID,
			VariableName: "GITHUB_CLIENT_SECRET",
		})
		require.NoError(t, err)
		require.IsType(t, &api.VariableByKind{}, res, helpers.MustMarshal(t, res))
		assert.Equal(t, api.VariableByKind{Primary: api.NewOptVariable(held)}, *res.(*api.VariableByKind))
		assert.NotContains(t, helpers.MustMarshal(t, res), "s3cr3t")
	})

	t.Run("get by name reads the project's value", func(t *testing.T) {
		res, err := client.GetVariable(t.Context(), api.GetVariableParams{
			ProjectID:    projectID,
			VariableName: "HOST",
		})
		require.NoError(t, err)
		require.IsType(t, &api.VariableByKind{}, res, helpers.MustMarshal(t, res))
		assert.Equal(t,
			api.VariableByKind{Primary: api.NewOptVariable(api.NewVariableScalarVariable(api.NewStringVariableScalar("example.com")))},
			*res.(*api.VariableByKind))
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

	t.Run("deleting a name removes it", func(t *testing.T) {
		res, err := client.DeleteVariable(t.Context(), api.DeleteVariableParams{
			ProjectID:    projectID,
			VariableName: "HOST",
		})
		require.NoError(t, err)
		require.IsType(t, &api.DeleteVariableNoContent{}, res, helpers.MustMarshal(t, res))

		assert.NotContains(t, get(t, api.OptVariableKind{}), "HOST")
	})

	// minProperties: 1 is in the contract, but ogen generates no check for it on
	// a map body, so without the handler's own guard an empty body would answer
	// 200 and change nothing — telling a client its update landed when it sent
	// none.
	t.Run("an empty body is rejected rather than silently doing nothing", func(t *testing.T) {
		res := update(t, api.OptVariableKind{}, api.UpdateVariablesRequest{})
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
		res := update(t, api.OptVariableKind{}, api.UpdateVariablesRequest{
			"WOULD_HAVE_WORKED": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("x")),
			"not a name":        api.NewVariableScalarVariableInput(api.NewStringVariableScalar("x")),
		})
		status, code, _, ok := errorResponseParts(t, res)
		require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, res))
		assert.Equal(t, http.StatusBadRequest, status)
		assert.Equal(t, domain.ErrInvalidVariableName().Code, code)

		vars := get(t, api.OptVariableKind{})
		assert.NotContains(t, vars, "not a name")
		assert.NotContains(t, vars, "WOULD_HAVE_WORKED",
			"a rejected body must leave the owner exactly as it was")
	})

	null := api.NewNullVariableInput(struct{}{})

	// The reason null-as-removal exists: several names go in one request, so a
	// caller tidying up does not have to walk them one DELETE at a time.
	t.Run("nulls remove several names in one request", func(t *testing.T) {
		update(t, api.OptVariableKind{}, api.UpdateVariablesRequest{
			"BULK_A": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("a")),
			"BULK_B": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("b")),
			"BULK_C": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("c")),
		})

		res := update(t, api.OptVariableKind{}, api.UpdateVariablesRequest{
			"BULK_A": null,
			"BULK_B": null,
		})
		require.IsType(t, &api.VariablesByKind{}, res, helpers.MustMarshal(t, res))
		// The response is the owner read back, so it already shows the removal.
		assert.NotContains(t, *res.(*api.VariablesByKind), "BULK_A")

		vars := get(t, api.OptVariableKind{})
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
		update(t, api.OptVariableKind{}, api.UpdateVariablesRequest{
			"MIX_OLD":      api.NewVariableScalarVariableInput(api.NewStringVariableScalar("old")),
			"MIX_REPLACED": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("before")),
		})

		update(t, api.OptVariableKind{}, api.UpdateVariablesRequest{
			"MIX_NEW":      api.NewVariableScalarVariableInput(api.NewStringVariableScalar("new")),
			"MIX_REPLACED": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("after")),
			"MIX_OLD":      null,
		})

		vars := get(t, api.OptVariableKind{})
		assert.Equal(t, api.NewVariableScalarVariable(api.NewStringVariableScalar("new")), vars["MIX_NEW"])
		assert.Equal(t, api.NewVariableScalarVariable(api.NewStringVariableScalar("after")), vars["MIX_REPLACED"])
		assert.NotContains(t, vars, "MIX_OLD")
	})

	// The one place a patch differs from DELETE /variables/{name}, which
	// answers var.not_found: a patch states what the owner holds afterwards,
	// and a name that was never there already satisfies that. It is also what
	// makes a retry of the request above safe.
	t.Run("a null on a name the owner does not hold is not an error", func(t *testing.T) {
		res := update(t, api.OptVariableKind{}, api.UpdateVariablesRequest{
			"NEVER_ENTERED": null,
		})
		require.IsType(t, &api.VariablesByKind{}, res, helpers.MustMarshal(t, res))
		assert.NotContains(t, *res.(*api.VariablesByKind), "NEVER_ENTERED")
	})

	// Secrets are the same resource, so they are removed the same way -- and
	// this is the removal that cannot be undone, since the value reads back
	// nowhere.
	t.Run("a null removes a secret too", func(t *testing.T) {
		update(t, api.OptVariableKind{}, api.UpdateVariablesRequest{
			"DOOMED_SECRET": api.NewSecretVariableInputVariableInput(api.SecretVariableInput{
				Value:  api.NewStringVariableScalar("s3cr3t"),
				Secret: true,
			}),
		})
		require.Contains(t, get(t, api.OptVariableKind{}), "DOOMED_SECRET")

		update(t, api.OptVariableKind{}, api.UpdateVariablesRequest{"DOOMED_SECRET": null})
		assert.NotContains(t, get(t, api.OptVariableKind{}), "DOOMED_SECRET")
	})

	// A removal is spelled with a name like any other entry, so it is held to
	// the same grammar -- and the body still lands whole or not at all.
	t.Run("a malformed name is rejected even when it is a removal", func(t *testing.T) {
		res := update(t, api.OptVariableKind{}, api.UpdateVariablesRequest{
			"WOULD_HAVE_WORKED_TOO": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("x")),
			"not a name":            null,
		})
		status, code, _, ok := errorResponseParts(t, res)
		require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, res))
		assert.Equal(t, http.StatusBadRequest, status)
		assert.Equal(t, domain.ErrInvalidVariableName().Code, code)

		assert.NotContains(t, get(t, api.OptVariableKind{}), "WOULD_HAVE_WORKED_TOO")
	})

	// A body of nothing but nulls is still a body: minProperties: 1 is about
	// the request naming something, not about it writing something.
	t.Run("a body of only nulls is accepted", func(t *testing.T) {
		update(t, api.OptVariableKind{}, api.UpdateVariablesRequest{
			"BULK_C": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("c")),
		})

		res := update(t, api.OptVariableKind{}, api.UpdateVariablesRequest{"BULK_C": null})
		require.IsType(t, &api.VariablesByKind{}, res, helpers.MustMarshal(t, res))
		assert.NotContains(t, get(t, api.OptVariableKind{}), "BULK_C")
	})

	t.Run("each kind holds its own value", func(t *testing.T) {
		preview := api.NewOptVariableKind(api.VariableKindPreview)
		scalar := func(s string) api.Variable {
			return api.NewVariableScalarVariable(api.NewStringVariableScalar(s))
		}

		update(t, api.OptVariableKind{}, api.UpdateVariablesRequest{
			"KIND_PLAIN": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("prod")),
			"KIND_SECRET": api.NewSecretVariableInputVariableInput(api.SecretVariableInput{
				Value:  api.NewStringVariableScalar("s3cr3t"),
				Secret: true,
			}),
		})
		update(t, preview, api.UpdateVariablesRequest{
			"KIND_PLAIN": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("test")),
		})

		res, err := client.GetVariables(t.Context(), api.GetVariablesParams{ProjectID: projectID})
		require.NoError(t, err)
		require.IsType(t, &api.VariablesByKind{}, res, helpers.MustMarshal(t, res))
		all := *res.(*api.VariablesByKind)
		assert.Equal(t, api.VariableByKind{
			Primary: api.NewOptVariable(scalar("prod")),
			Preview: api.NewOptVariable(scalar("test")),
		}, all["KIND_PLAIN"])
		assert.Equal(t, api.VariableByKind{
			Primary: api.NewOptVariable(api.NewSecretVariableVariable(api.SecretVariable{Secret: true})),
		}, all["KIND_SECRET"], "a secret naming no kind reaches primary only")

		missing, err := client.GetVariable(t.Context(), api.GetVariableParams{
			ProjectID:    projectID,
			VariableName: "KIND_SECRET",
			Kind:         preview,
		})
		require.NoError(t, err)
		status, code, _, ok := errorResponseParts(t, missing)
		require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, missing))
		assert.Equal(t, http.StatusNotFound, status)
		assert.Equal(t, domain.ErrVariableNotFound().Code, code)

		deleted, err := client.DeleteVariable(t.Context(), api.DeleteVariableParams{
			ProjectID:    projectID,
			VariableName: "KIND_PLAIN",
			Kind:         preview,
		})
		require.NoError(t, err)
		require.IsType(t, &api.DeleteVariableNoContent{}, deleted, helpers.MustMarshal(t, deleted))
		assert.Equal(t, scalar("prod"), get(t, api.OptVariableKind{})["KIND_PLAIN"],
			"removing the preview value leaves the primary one")
	})
}

func primaryValues(vars api.VariablesByKind) map[string]api.Variable {
	out := make(map[string]api.Variable, len(vars))
	for name, byKind := range vars {
		if value, ok := byKind.Primary.Get(); ok {
			out[name] = value
		}
	}
	return out
}
