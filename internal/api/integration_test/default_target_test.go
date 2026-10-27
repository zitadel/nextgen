//go:build postgres_integration || spanner_integration

package integration_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// deployDefaultTarget deploys a release of what the project holds now to the
// default target: its user schemas, the newest flow definition of each name,
// its identity providers, its newest branding, and its policies. A flow opened
// with no origin, and a management call, then serve those revisions. Call it
// again after publishing something the next request should serve.
func deployDefaultTarget(t *testing.T, projectID string) {
	t.Helper()
	ctx := service.WithAuthzListUnrestricted(t.Context())

	pointers := make([]service.CreateReleasePointer, 0, 8)
	schemas, err := harness.EnsureSchemaService(t).ListSchemas(ctx, service.ListSchemasInput{
		ProjectID:                   projectID,
		LatestRevisionPerObjectType: true,
		Limit:                       100,
	})
	require.NoError(t, err)
	for _, schema := range schemas.Items {
		if schema.ObjectType == nil {
			continue
		}
		pointers = append(pointers, service.CreateReleasePointer{
			Kind:       domain.ReleasePointerKindSchema,
			RevisionID: schema.URL,
		})
	}

	flows, err := harness.EnsureFlowDefinitionService(t).List(ctx, service.ListFlowDefinitionsRequest{
		ProjectID:             projectID,
		LatestRevisionPerName: true,
		Limit:                 100,
	})
	require.NoError(t, err)
	for _, def := range flows.Items {
		pointers = append(pointers, service.CreateReleasePointer{
			Kind:       domain.ReleasePointerKindFlowDefinition,
			RevisionID: def.ID,
		})
	}

	connections, err := harness.EnsureIDPConnectionService(t).List(ctx, service.ListIDPConnectionsInput{
		ProjectID: projectID,
		Limit:     100,
	})
	require.NoError(t, err)
	for _, connection := range connections.Items {
		pointers = append(pointers, service.CreateReleasePointer{
			Kind:       domain.ReleasePointerKindIDP,
			RevisionID: connection.RevisionID,
		})
	}

	brandings, err := harness.EnsureBrandingService(t).List(ctx, projectID)
	require.NoError(t, err)
	if len(brandings) > 0 {
		pointers = append(pointers, service.CreateReleasePointer{
			Kind:       domain.ReleasePointerKindBranding,
			RevisionID: brandings[0].ID,
		})
	}

	policies, err := harness.EnsurePolicyService(t).List(ctx, service.ListPoliciesInput{
		ProjectID: projectID,
		Limit:     100,
	})
	require.NoError(t, err)
	for _, policy := range policies.Items {
		pointers = append(pointers, service.CreateReleasePointer{
			Kind:       domain.ReleasePointerKindPolicy,
			RevisionID: policy.RevisionID,
		})
	}

	created, err := harness.EnsureReleaseService(t).Create(t.Context(), service.CreateReleaseInput{
		ProjectID: projectID,
		Pointers:  pointers,
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
