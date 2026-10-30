//go:build postgres_integration || spanner_integration

package integration_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/sync/errgroup"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	platformbootstrap "github.com/zitadel/nextgen/internal/bootstrap/platform"
	"github.com/zitadel/nextgen/internal/domain"
)

// TestPlatformProjectSignsInFromTheConsole bootstraps the platform project as
// the server does on start, twice, and signs in to it from the console's
// origin the way the console does: the flow opens and its first step is
// submitted there.
func TestPlatformProjectSignsInFromTheConsole(t *testing.T) {
	projects := harness.EnsureProjectService(t)
	require.NoError(t, platformbootstrap.Ensure(t.Context(), projects, harness.EnsureServiceDB(t), true))
	// The platform project is outside any test's own project, so this test
	// removes it (internal/AGENTS.md).
	t.Cleanup(func() {
		_, _ = harness.EnsureServiceDB(t).Statements().DeleteProjectByID(context.Background(), domain.PlatformProjectID)
	})
	deploy := func() error {
		return platformbootstrap.EnsureDeployed(t.Context(), helpers.BuiltinSchemaBaseURL, time.Now(),
			helpers.ConsoleOrigin, projects, harness.EnsureReleaseService(t), harness.EnsureDeploymentService(t))
	}
	served := func() []domain.OriginDeployment {
		t.Helper()
		read, err := harness.EnsureServiceDB(t).Statements().GetNewestPerOrigin(t.Context(), domain.PlatformProjectID,
			[]string{helpers.ConsoleOrigin})
		require.NoError(t, err)
		return read
	}

	// Replicas that start together race on an empty project: on a serverless
	// platform a cold burst brings up one per request.
	var starts errgroup.Group
	for range 4 {
		starts.Go(deploy)
	}
	require.NoError(t, starts.Wait())
	first := served()
	require.Len(t, first, 1, "the console origin is served")
	require.NoError(t, deploy())
	assert.Equal(t, first, served(), "a restart that changes nothing deploys nothing")

	resp, body := openFlow(t, domain.PlatformProjectID, helpers.ConsoleOrigin)
	require.Equal(t, http.StatusCreated, resp.StatusCode, string(body))
	var opened api.FlowResponse
	require.NoError(t, opened.UnmarshalJSON(body), string(body))

	resp, body = submitFlow(t, opened.ID, flowCookie(t, resp), helpers.ConsoleOrigin)
	assert.Less(t, resp.StatusCode, http.StatusBadRequest, string(body))
	var answered api.FlowResponse
	require.NoError(t, answered.UnmarshalJSON(body), string(body))
}
