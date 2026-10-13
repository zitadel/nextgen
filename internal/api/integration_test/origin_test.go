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

// TestOriginsNotImplemented pins add/remove to 501 until the origins service
// lands. Access still runs first.
func TestOriginsNotImplemented(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, false)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	// Management ops still require the project.write credential ceiling
	// (ADR 037 / #420); OpenAPI's origin.* scopes are not a substitute yet.
	harness.SetProjectSecretOnApiClient(t, client, project)

	expectNotImplemented := func(t *testing.T, resp any) {
		t.Helper()
		status, code, _, ok := errorResponseParts(t, resp)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, http.StatusNotImplemented, status)
		assert.Equal(t, domain.ErrNotImplemented().Code, code)
	}

	t.Run("add", func(t *testing.T) {
		resp, err := client.AddOrigin(t.Context(), &api.ProjectOrigin{
			Pattern: "https://app.example.com",
			Kind:    api.ProjectOriginKindPrimary,
		}, api.AddOriginParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		expectNotImplemented(t, resp)
	})

	t.Run("remove", func(t *testing.T) {
		resp, err := client.RemoveOrigin(t.Context(), &api.RemoveOriginReq{
			Pattern: "https://app.example.com",
		}, api.RemoveOriginParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		expectNotImplemented(t, resp)
	})
}
