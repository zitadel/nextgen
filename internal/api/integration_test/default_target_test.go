//go:build postgres_integration || spanner_integration

package integration_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// deployDefaultTarget deploys a release that pins the seeded user schema and
// no flow definition. Callers with no origin then resolve a release, and
// readers that still follow the newest revision when a release pins no flow
// keep doing so.
func deployDefaultTarget(t *testing.T, projectID string) {
	t.Helper()
	created, err := harness.EnsureReleaseService(t).Create(t.Context(), service.CreateReleaseInput{
		ProjectID: projectID,
		Pointers: []service.CreateReleasePointer{{
			Kind:       domain.ReleasePointerKindSchema,
			RevisionID: apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL),
		}},
	})
	require.NoError(t, err)
	_, err = harness.EnsureDeploymentService(t).Deploy(t.Context(), service.DeployInput{
		ProjectID: projectID,
		ReleaseID: created.Release.ID,
		Targets:   []string{domain.DeploymentTargetDefault},
		Reason:    domain.DeploymentReasonDeploy,
	})
	require.NoError(t, err)
}
