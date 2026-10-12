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

	h := helpers.EnsureTestServer(t)
	client, projectID := helpers.EnsureProjectService(t, h)

	expectNotImplemented := func(t *testing.T, resp any) {
		t.Helper()
		status, code, _, ok := errorResponseParts(t, resp)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, http.StatusNotImplemented, status)
		assert.Equal(t, domain.ErrNotImplemented().Code, code)
	}

	t.Run("add", func(t *testing.T) {
		resp, err := client.AddOrigin(t.Context(), &api.Origin{
			Pattern: "https://app.example.com",
			Kind:    api.OriginKindPrimary,
		}, api.AddOriginParams{ProjectID: api.ProjectID(projectID)})
		require.NoError(t, err)
		expectNotImplemented(t, resp)
	})

	t.Run("remove", func(t *testing.T) {
		resp, err := client.RemoveOrigin(t.Context(), &api.RemoveOriginReq{
			Pattern: "https://app.example.com",
		}, api.RemoveOriginParams{ProjectID: api.ProjectID(projectID)})
		require.NoError(t, err)
		expectNotImplemented(t, resp)
	})
}
