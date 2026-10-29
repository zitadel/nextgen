//go:build postgres_integration || spanner_integration

package integration_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	platformbootstrap "github.com/zitadel/nextgen/internal/bootstrap/platform"
	"github.com/zitadel/nextgen/internal/domain"
)

// TestPlatformProjectSignsInFromTheConsole runs the start-up deploy of the
// platform project twice, the second a restart that changes nothing, and
// signs in to it from the console's origin the way the console does: the
// flow opens and its first step is submitted there.
func TestPlatformProjectSignsInFromTheConsole(t *testing.T) {
	platform := harness.EnsurePlatformProject(t)
	deploy := func() {
		t.Helper()
		require.NoError(t, platformbootstrap.EnsureDeployed(t.Context(), helpers.ConsoleOrigin,
			harness.EnsureProjectService(t), platformbootstrap.Catalog{
				Schemas:        harness.EnsureSchemaService(t),
				Flows:          harness.EnsureFlowDefinitionService(t),
				IDPConnections: harness.EnsureIDPConnectionService(t),
				Policies:       harness.EnsurePolicyService(t),
				Branding:       harness.EnsureBrandingService(t),
			}, harness.EnsureReleaseService(t), harness.EnsureDeploymentService(t)))
	}
	served := func() []domain.OriginDeployment {
		t.Helper()
		read, err := harness.EnsureServiceDB(t).Statements().GetNewestPerOrigin(t.Context(), platform.ID,
			[]string{helpers.ConsoleOrigin, domain.DefaultTargetOrigin})
		require.NoError(t, err)
		return read
	}

	deploy()
	first := served()
	require.Len(t, first, 2, "the console origin and the default target are both served")
	deploy()
	assert.Equal(t, first, served(), "a restart that changes nothing deploys nothing")

	resp, body := openFlow(t, platform.ID, helpers.ConsoleOrigin)
	require.Equal(t, http.StatusCreated, resp.StatusCode, string(body))
	var opened api.FlowResponse
	require.NoError(t, opened.UnmarshalJSON(body), string(body))

	resp, body = submitFlow(t, opened.ID, flowCookie(t, resp), helpers.ConsoleOrigin)
	assert.Less(t, resp.StatusCode, http.StatusBadRequest, string(body))
	var answered api.FlowResponse
	require.NoError(t, answered.UnmarshalJSON(body), string(body))
}
