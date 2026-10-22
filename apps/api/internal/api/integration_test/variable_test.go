//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/events"
)

// TestVariables covers the variables surface (ADR 062, ADR 069): that a
// project reads and writes its variables per kind, that a secret is held but
// never handed back, and that every row written or removed is recorded.
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
	// getByKind reads the variables as the wire returns them: keyed by name,
	// each with its value per kind.
	getByKind := func(t *testing.T, kind api.OptVariableKind) api.VariablesByKind {
		t.Helper()
		res, err := client.GetVariables(t.Context(), api.GetVariablesParams{
			ProjectID: projectID,
			Kind:      kind,
		})
		require.NoError(t, err)
		require.IsType(t, &api.VariablesByKind{}, res, helpers.MustMarshal(t, res))
		return *res.(*api.VariablesByKind)
	}
	// get reads the primary values, keyed by name.
	get := func(t *testing.T, kind api.OptVariableKind) map[string]api.Variable {
		t.Helper()
		return primaryValues(getByKind(t, kind))
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

	// Entered without a kind, so a plain value is held for both kinds and the
	// read without one shows both.
	t.Run("get by name reads the project's value", func(t *testing.T) {
		res, err := client.GetVariable(t.Context(), api.GetVariableParams{
			ProjectID:    projectID,
			VariableName: "HOST",
		})
		require.NoError(t, err)
		require.IsType(t, &api.VariableByKind{}, res, helpers.MustMarshal(t, res))
		host := api.NewOptVariable(api.NewVariableScalarVariable(api.NewStringVariableScalar("example.com")))
		assert.Equal(t, api.VariableByKind{Primary: host, Preview: host}, *res.(*api.VariableByKind))
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

	preview := api.NewOptVariableKind(api.VariableKindPreview)
	primary := api.NewOptVariableKind(api.VariableKindPrimary)
	scalar := func(value string) api.Variable {
		return api.NewVariableScalarVariable(api.NewStringVariableScalar(value))
	}
	secret := func(value string) api.VariableInput {
		return api.NewSecretVariableInputVariableInput(api.SecretVariableInput{
			Value:  api.NewStringVariableScalar(value),
			Secret: true,
		})
	}
	held := api.NewSecretVariableVariable(api.SecretVariable{Secret: true})
	getOne := func(t *testing.T, name string, kind api.OptVariableKind) api.GetVariableRes {
		t.Helper()
		res, err := client.GetVariable(t.Context(), api.GetVariableParams{
			ProjectID:    projectID,
			VariableName: api.VariableName(name),
			Kind:         kind,
		})
		require.NoError(t, err)
		return res
	}
	del := func(t *testing.T, name string, kind api.OptVariableKind) api.DeleteVariableRes {
		t.Helper()
		res, err := client.DeleteVariable(t.Context(), api.DeleteVariableParams{
			ProjectID:    projectID,
			VariableName: api.VariableName(name),
			Kind:         kind,
		})
		require.NoError(t, err)
		return res
	}

	// The default a write without a kind gets: a plain value is for both
	// targets, a secret for primary only, since a preview URL is reachable by
	// anyone who can guess it -- and the secret takes the name's preview
	// value with it, so a preview never keeps a plaintext copy.
	t.Run("without a kind, a plain value applies to both kinds and a secret to primary only", func(t *testing.T) {
		// The preview value the secret is about to replace.
		update(t, preview, api.UpdateVariablesRequest{
			"KIND_SECRET": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("pasted-in-clear")),
		})

		update(t, api.OptVariableKind{}, api.UpdateVariablesRequest{
			"KIND_HOST":   api.NewVariableScalarVariableInput(api.NewStringVariableScalar("example.com")),
			"KIND_SECRET": secret("s3cr3t"),
		})

		all := getByKind(t, api.OptVariableKind{})
		assert.Equal(t, api.VariableByKind{
			Primary: api.NewOptVariable(scalar("example.com")),
			Preview: api.NewOptVariable(scalar("example.com")),
		}, all["KIND_HOST"])
		assert.Equal(t, api.VariableByKind{Primary: api.NewOptVariable(held)}, all["KIND_SECRET"],
			"a secret written without a kind must not reach preview, and removes the preview value it replaces")

		// The kind filters: a read of preview shows the preview slot alone,
		// and a name with no preview row is absent, not filled from primary.
		onlyPreview := getByKind(t, preview)
		assert.Equal(t, api.VariableByKind{Preview: api.NewOptVariable(scalar("example.com"))}, onlyPreview["KIND_HOST"])
		assert.NotContains(t, onlyPreview, "KIND_SECRET")

		res := getOne(t, "KIND_SECRET", preview)
		status, code, _, ok := errorResponseParts(t, res)
		require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, res))
		assert.Equal(t, http.StatusNotFound, status)
		assert.Equal(t, domain.ErrVariableNotFound().Code, code)

		onlyPrimary := getByKind(t, primary)
		assert.Equal(t, api.VariableByKind{Primary: api.NewOptVariable(scalar("example.com"))}, onlyPrimary["KIND_HOST"])
		assert.Equal(t, api.VariableByKind{Primary: api.NewOptVariable(held)}, onlyPrimary["KIND_SECRET"])
	})

	// Naming preview is the only way a secret reaches a preview target, and a
	// write with a kind leaves the other kind's value alone.
	t.Run("with a kind, only that kind is written", func(t *testing.T) {
		res := update(t, preview, api.UpdateVariablesRequest{
			"KIND_HOST":   api.NewVariableScalarVariableInput(api.NewStringVariableScalar("preview.example.com")),
			"KIND_SECRET": secret("preview-s3cr3t"),
		})
		require.IsType(t, &api.VariablesByKind{}, res, helpers.MustMarshal(t, res))
		// The response is the read the request's kind gets.
		assert.Equal(t, api.VariableByKind{Preview: api.NewOptVariable(scalar("preview.example.com"))},
			(*res.(*api.VariablesByKind))["KIND_HOST"])

		all := getByKind(t, api.OptVariableKind{})
		assert.Equal(t, api.VariableByKind{
			Primary: api.NewOptVariable(scalar("example.com")),
			Preview: api.NewOptVariable(scalar("preview.example.com")),
		}, all["KIND_HOST"])
		assert.Equal(t, api.VariableByKind{
			Primary: api.NewOptVariable(held),
			Preview: api.NewOptVariable(held),
		}, all["KIND_SECRET"])
	})

	t.Run("get by name returns the kinds the name is held for", func(t *testing.T) {
		update(t, primary, api.UpdateVariablesRequest{
			"KIND_PRIMARY_ONLY": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("p")),
		})

		res := getOne(t, "KIND_PRIMARY_ONLY", api.OptVariableKind{})
		require.IsType(t, &api.VariableByKind{}, res, helpers.MustMarshal(t, res))
		assert.Equal(t, api.VariableByKind{Primary: api.NewOptVariable(scalar("p"))}, *res.(*api.VariableByKind))

		res = getOne(t, "KIND_PRIMARY_ONLY", primary)
		require.IsType(t, &api.VariableByKind{}, res, helpers.MustMarshal(t, res))
		assert.Equal(t, api.VariableByKind{Primary: api.NewOptVariable(scalar("p"))}, *res.(*api.VariableByKind))

		// Held for primary alone, so for preview it is a name nobody entered.
		res = getOne(t, "KIND_PRIMARY_ONLY", preview)
		status, code, _, ok := errorResponseParts(t, res)
		require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, res))
		assert.Equal(t, http.StatusNotFound, status)
		assert.Equal(t, domain.ErrVariableNotFound().Code, code)
	})

	t.Run("a null with a kind removes that kind only", func(t *testing.T) {
		update(t, preview, api.UpdateVariablesRequest{"KIND_HOST": null})

		assert.Equal(t, api.VariableByKind{Primary: api.NewOptVariable(scalar("example.com"))},
			getByKind(t, api.OptVariableKind{})["KIND_HOST"])
	})

	t.Run("deleting with a kind leaves the other kind", func(t *testing.T) {
		res := del(t, "KIND_SECRET", preview)
		require.IsType(t, &api.DeleteVariableNoContent{}, res, helpers.MustMarshal(t, res))

		assert.Equal(t, api.VariableByKind{Primary: api.NewOptVariable(held)},
			getByKind(t, api.OptVariableKind{})["KIND_SECRET"])

		// Gone for that kind, so the same delete is now a miss, while the
		// primary row is untouched by it.
		res = del(t, "KIND_SECRET", preview)
		status, code, _, ok := errorResponseParts(t, res)
		require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, res))
		assert.Equal(t, http.StatusNotFound, status)
		assert.Equal(t, domain.ErrVariableNotFound().Code, code)
		assert.Contains(t, getByKind(t, api.OptVariableKind{}), "KIND_SECRET")
	})

	t.Run("deleting without a kind removes both", func(t *testing.T) {
		update(t, api.OptVariableKind{}, api.UpdateVariablesRequest{
			"KIND_BOTH": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("x")),
		})
		both := getByKind(t, api.OptVariableKind{})["KIND_BOTH"]
		require.True(t, both.Primary.Set && both.Preview.Set, "entered for both kinds: %s", helpers.MustMarshal(t, both))

		res := del(t, "KIND_BOTH", api.OptVariableKind{})
		require.IsType(t, &api.DeleteVariableNoContent{}, res, helpers.MustMarshal(t, res))
		assert.NotContains(t, getByKind(t, api.OptVariableKind{}), "KIND_BOTH")

		res = del(t, "KIND_BOTH", api.OptVariableKind{})
		status, code, _, ok := errorResponseParts(t, res)
		require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, res))
		assert.Equal(t, http.StatusNotFound, status)
		assert.Equal(t, domain.ErrVariableNotFound().Code, code)
	})

	// The preview credential is browser-plane: it may run a preview, never
	// manage the project, and variables are management however they are
	// addressed -- a preview secret cannot even read the preview values.
	t.Run("a preview credential is refused on every operation", func(t *testing.T) {
		previewClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetPreviewSecretOnApiClient(t, previewClient, project)

		refused := func(t *testing.T, res any) {
			t.Helper()
			status, code, _, ok := errorResponseParts(t, res)
			require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, res))
			assert.Equal(t, http.StatusForbidden, status)
			assert.Equal(t, domain.ErrVariablePermissionDenied().Code, code)
		}

		list, err := previewClient.GetVariables(t.Context(), api.GetVariablesParams{ProjectID: projectID, Kind: preview})
		require.NoError(t, err)
		refused(t, list)

		one, err := previewClient.GetVariable(t.Context(), api.GetVariableParams{
			ProjectID: projectID, VariableName: "KIND_HOST", Kind: preview,
		})
		require.NoError(t, err)
		refused(t, one)

		written, err := previewClient.UpdateVariables(t.Context(), api.UpdateVariablesRequest{
			"NEVER_LANDS": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("x")),
		}, api.UpdateVariablesParams{ProjectID: projectID, Kind: preview})
		require.NoError(t, err)
		refused(t, written)
		assert.NotContains(t, getByKind(t, api.OptVariableKind{}), "NEVER_LANDS")

		deleted, err := previewClient.DeleteVariable(t.Context(), api.DeleteVariableParams{
			ProjectID: projectID, VariableName: "KIND_HOST", Kind: preview,
		})
		require.NoError(t, err)
		refused(t, deleted)
		assert.Contains(t, getByKind(t, api.OptVariableKind{}), "KIND_HOST")
	})

	// A deployment freezes one kind's variables into one cell, and the cap is
	// what keeps that freeze from ever failing. The largest entry a secret
	// makes is a value of characters JSON escapes, so a few dozen of them
	// pass 9 MiB -- and the body lands whole or not at all, so none of them
	// is written.
	t.Run("a write after which a kind would not fit in one deployment is refused", func(t *testing.T) {
		body := make(api.UpdateVariablesRequest, 80)
		for i := range 80 {
			body[fmt.Sprintf("CAP_%d", i)] = secret(strings.Repeat("<>&", domain.MaxVariableStringLength/3))
		}
		res := update(t, api.OptVariableKind{}, body)
		status, code, _, ok := errorResponseParts(t, res)
		require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, res))
		assert.Equal(t, http.StatusBadRequest, status)
		assert.Equal(t, domain.ErrVariableLimitExceeded().Code, code)

		for name := range getByKind(t, api.OptVariableKind{}) {
			assert.NotContains(t, name, "CAP_", "a refused body must leave the project exactly as it was")
		}
	})

	// Every row written or removed is one audit event, and the value is in
	// none of them: a plain value may be a secret the caller forgot to flag.
	t.Run("every row written or removed is recorded, without its value", func(t *testing.T) {
		// A preview value for the secret to clear, so that removal is on
		// record too.
		update(t, preview, api.UpdateVariablesRequest{
			"AUDITED_SECRET": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("plain-value")),
		})
		update(t, api.OptVariableKind{}, api.UpdateVariablesRequest{
			"AUDITED":        api.NewVariableScalarVariableInput(api.NewStringVariableScalar("plain-value")),
			"AUDITED_SECRET": secret("audit-s3cr3t"),
		})
		res := del(t, "AUDITED", api.OptVariableKind{})
		require.IsType(t, &api.DeleteVariableNoContent{}, res, helpers.MustMarshal(t, res))

		// Read through the statements: the events API hides the events of a
		// project nobody has claimed, and this one was created in-process.
		opts := events.ListOptions(project.ID, 100)
		opts.Filter = database.And(opts.Filter, database.Equal(database.Col(domain.EventFieldEntityType), "variable"))
		page, err := harness.EnsureServiceDB(t).Statements().ListEvents(t.Context(), opts)
		require.NoError(t, err)

		// The payload is compared as an object: JSONB does not keep key order.
		type recorded struct {
			eventType domain.EventType
			entityID  string
			payload   map[string]any
		}
		got := make([]recorded, 0, len(page.Items))
		for _, event := range page.Items {
			require.NotNil(t, event.EntityID)
			if !strings.HasPrefix(*event.EntityID, "AUDITED") {
				continue
			}
			for _, value := range []string{"plain-value", "audit-s3cr3t"} {
				assert.NotContains(t, string(event.Payload), value)
			}
			assert.Equal(t, domain.EventCategoryEntity, event.Category)
			var payload map[string]any
			require.NoError(t, json.Unmarshal(event.Payload, &payload))
			got = append(got, recorded{event.EventType, *event.EntityID, payload})
		}
		assert.ElementsMatch(t, []recorded{
			{domain.EventTypeVariableSet, "AUDITED", map[string]any{"kind": "primary", "secret": false}},
			{domain.EventTypeVariableSet, "AUDITED", map[string]any{"kind": "preview", "secret": false}},
			{domain.EventTypeVariableSet, "AUDITED_SECRET", map[string]any{"kind": "preview", "secret": false}},
			{domain.EventTypeVariableRemoved, "AUDITED_SECRET", map[string]any{"kind": "preview"}},
			{domain.EventTypeVariableSet, "AUDITED_SECRET", map[string]any{"kind": "primary", "secret": true}},
			{domain.EventTypeVariableRemoved, "AUDITED", map[string]any{"kind": "primary"}},
			{domain.EventTypeVariableRemoved, "AUDITED", map[string]any{"kind": "preview"}},
		}, got)
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
