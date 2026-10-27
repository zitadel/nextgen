//go:build postgres_integration || spanner_integration

package integration_test

import (
	"context"
	"fmt"
	"slices"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// deployDefaultTarget deploys a release of what the project holds now to the
// default target. A flow opened with no origin, and a management call, then
// serve those revisions. Call it again after publishing something the next
// request should serve.
func deployDefaultTarget(t *testing.T, projectID string) {
	t.Helper()
	ctx := service.WithAuthzListUnrestricted(t.Context())
	content, err := defaultTargetContent(t, ctx, projectID)
	require.NoError(t, err)
	pointers, err := content.Pointers()
	require.NoError(t, err)
	require.NotEmpty(t, pointers, "a default target needs at least one revision")

	created, err := harness.EnsureReleaseService(t).Create(t.Context(), service.CreateReleaseInput{
		ProjectID: projectID,
		Pointers:  releasePointers(pointers),
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

func defaultTargetContent(t *testing.T, ctx context.Context, projectID string) (domain.ReleaseContent, error) {
	t.Helper()
	schemas, err := harness.EnsureSchemaService(t).ListSchemas(ctx, service.ListSchemasInput{
		ProjectID:                   projectID,
		LatestRevisionPerObjectType: true,
		Limit:                       100,
	})
	if err != nil {
		return domain.ReleaseContent{}, err
	}
	if err := onePage(schemas.NextPageToken, "schemas"); err != nil {
		return domain.ReleaseContent{}, err
	}
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
	if err != nil {
		return domain.ReleaseContent{}, err
	}
	if err := onePage(flows.NextPageToken, "flow definitions"); err != nil {
		return domain.ReleaseContent{}, err
	}
	connections, err := harness.EnsureIDPConnectionService(t).List(ctx, service.ListIDPConnectionsInput{
		ProjectID: projectID,
		Limit:     100,
	})
	if err != nil {
		return domain.ReleaseContent{}, err
	}
	if err := onePage(connections.NextPageToken, "identity providers"); err != nil {
		return domain.ReleaseContent{}, err
	}
	brandings, err := harness.EnsureBrandingService(t).List(ctx, projectID)
	if err != nil {
		return domain.ReleaseContent{}, err
	}
	policies, err := harness.EnsurePolicyService(t).List(ctx, service.ListPoliciesInput{
		ProjectID: projectID,
		Limit:     100,
	})
	if err != nil {
		return domain.ReleaseContent{}, err
	}
	if err := onePage(policies.NextPageToken, "policies"); err != nil {
		return domain.ReleaseContent{}, err
	}
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
	}, nil
}

func onePage(token, kind string) error {
	if token != "" {
		return fmt.Errorf("list %s: more than one page", kind)
	}
	return nil
}

func releasePointers(pointers []domain.ReleasePointer) []service.CreateReleasePointer {
	out := make([]service.CreateReleasePointer, len(pointers))
	for i, pointer := range pointers {
		out[i] = service.CreateReleasePointer{Kind: pointer.Kind, RevisionID: pointer.RevisionID}
	}
	return out
}
