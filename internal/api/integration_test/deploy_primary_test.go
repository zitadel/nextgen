//go:build postgres_integration || spanner_integration

package integration_test

import (
	"context"
	"slices"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// primaryOriginForTests is the primary origin deployPrimary gives a project, so
// that it can deploy.
const primaryOriginForTests = "https://deployed.acme.test"

// deployPrimary deploys a release of what the project holds now. A flow opened
// with no origin, and a management call, then serve those revisions. Call it
// again after publishing something the next request should serve.
func deployPrimary(t *testing.T, projectID string) {
	t.Helper()
	_, err := harness.EnsureProjectService(t).AddOrigin(t.Context(), projectID, domain.Origin{Pattern: primaryOriginForTests, Kind: domain.OriginKindPrimary})
	require.NoError(t, err)
	ctx := service.WithAuthzListUnrestricted(t.Context())
	pointers, err := projectContent(t, ctx, projectID).Pointers()
	require.NoError(t, err)
	require.NotEmpty(t, pointers, "a deployment needs at least one revision")

	created, err := harness.EnsureReleaseService(t).Create(t.Context(), service.CreateReleaseInput{
		ProjectID: projectID,
		Pointers:  releasePointers(pointers),
	})
	require.NoError(t, err)
	_, err = harness.EnsureDeploymentService(t).Deploy(t.Context(), service.DeployInput{
		ProjectID: projectID,
		ReleaseID: created.Release.ID,
		Reason:    domain.DeploymentReasonDeploy,
	})
	require.NoError(t, err)
}

// releaseContext serves an empty release to a test that calls a service
// directly, so no policy applies.
func releaseContext(t *testing.T) context.Context {
	t.Helper()
	return service.WithRuntimeResolution(t.Context(), &service.RuntimeResolution{Release: &domain.Release{}})
}

func projectContent(t *testing.T, ctx context.Context, projectID string) domain.ReleaseContent {
	t.Helper()
	schemas, err := harness.EnsureSchemaService(t).ListSchemas(ctx, service.ListSchemasInput{
		ProjectID:                   projectID,
		LatestRevisionPerObjectType: true,
		Limit:                       100,
	})
	require.NoError(t, err)
	require.Empty(t, schemas.NextPageToken)
	// A schema whose document was never parsed declares no objectType, so it
	// is not a revision a release can pin.
	schemas.Items = slices.DeleteFunc(schemas.Items, func(schema *domain.JSONSchema) bool {
		return schema.ObjectType == nil || *schema.ObjectType == ""
	})
	flows, err := harness.EnsureFlowDefinitionService(t).List(ctx, service.ListFlowDefinitionsRequest{
		ProjectID:             projectID,
		LatestRevisionPerName: true,
		Limit:                 100,
	})
	require.NoError(t, err)
	require.Empty(t, flows.NextPageToken)
	connections, err := harness.EnsureIDPConnectionService(t).List(ctx, service.ListIDPConnectionsInput{
		ProjectID: projectID,
		Limit:     100,
	})
	require.NoError(t, err)
	require.Empty(t, connections.NextPageToken)
	brandings, err := harness.EnsureBrandingService(t).List(ctx, projectID)
	require.NoError(t, err)
	policies, err := harness.EnsurePolicyService(t).List(ctx, service.ListPoliciesInput{
		ProjectID: projectID,
		Limit:     100,
	})
	require.NoError(t, err)
	require.Empty(t, policies.NextPageToken)
	var branding *domain.Branding
	if len(brandings) > 0 {
		branding = brandings[0]
	}
	return domain.ReleaseContent{
		Schemas:         schemas.Items,
		FlowDefinitions: flows.Items,
		IDPConnections:  connections.Items,
		Policies:        policies.Items,
		Branding:        branding,
	}
}

func releasePointers(pointers []domain.ReleasePointer) []service.CreateReleasePointer {
	out := make([]service.CreateReleasePointer, len(pointers))
	for i, pointer := range pointers {
		out[i] = service.CreateReleasePointer{Kind: pointer.Kind, RevisionID: pointer.RevisionID}
	}
	return out
}
