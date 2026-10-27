package platform

import (
	"context"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// schemaCatalog lists the revisions a default release can pin.
type schemaCatalog interface {
	ListSchemas(ctx context.Context, input service.ListSchemasInput) (*service.ListSchemasOutput, error)
}

// flowCatalog lists the flow definitions a default release can pin.
type flowCatalog interface {
	List(ctx context.Context, req service.ListFlowDefinitionsRequest) (*service.ListFlowDefinitionsResponse, error)
}

// releasePublisher creates the release the default target serves.
type releasePublisher interface {
	Create(ctx context.Context, input service.CreateReleaseInput) (*service.CreateReleaseOutput, error)
}

// targetDeployer deploys that release to the default target.
type targetDeployer interface {
	Deploy(ctx context.Context, input service.DeployInput) (*service.CreateDeploymentOutput, error)
}

// EnsureDefaultTarget deploys the platform project's current schemas and login
// flows to the default target, once. The project lists no origins, so the
// console reaches it only through that target. A start that finds one already
// serving leaves it: a later publish is a deploy, not a restart.
func EnsureDefaultTarget(
	ctx context.Context,
	pool service.StatementPool,
	schemas schemaCatalog,
	flows flowCatalog,
	releases releasePublisher,
	deployments targetDeployer,
) error {
	ctx = service.WithAuthzListUnrestricted(ctx)
	serving, err := pool.Statements().GetNewestPerOrigin(ctx, domain.PlatformProjectID, []string{domain.DefaultTargetOrigin})
	if err != nil {
		return fmt.Errorf("read platform default target: %w", err)
	}
	if len(serving) > 0 {
		return nil
	}

	content, err := platformContent(ctx, schemas, flows)
	if err != nil {
		return err
	}
	pointers, err := content.Pointers()
	if err != nil {
		return fmt.Errorf("pin platform default target: %w", err)
	}
	if len(pointers) == 0 {
		return nil
	}
	created, err := releases.Create(ctx, service.CreateReleaseInput{
		ProjectID: domain.PlatformProjectID,
		Pointers:  releasePointers(pointers),
	})
	if err != nil {
		return fmt.Errorf("release platform default target: %w", err)
	}
	if _, err := deployments.Deploy(ctx, service.DeployInput{
		ProjectID: domain.PlatformProjectID,
		ReleaseID: created.Release.ID,
		Targets:   []string{domain.DeploymentTargetDefault},
		Reason:    domain.DeploymentReasonDeploy,
	}); err != nil {
		return fmt.Errorf("deploy platform default target: %w", err)
	}
	return nil
}

func platformContent(ctx context.Context, schemas schemaCatalog, flows flowCatalog) (domain.ReleaseContent, error) {
	listedSchemas, err := schemas.ListSchemas(ctx, service.ListSchemasInput{
		ProjectID:                   domain.PlatformProjectID,
		LatestRevisionPerObjectType: true,
		Limit:                       100,
	})
	if err != nil {
		return domain.ReleaseContent{}, fmt.Errorf("list platform schemas: %w", err)
	}
	if listedSchemas.NextPageToken != "" {
		return domain.ReleaseContent{}, fmt.Errorf("list platform schemas: more than one page")
	}
	listedFlows, err := flows.List(ctx, service.ListFlowDefinitionsRequest{
		ProjectID:             domain.PlatformProjectID,
		LatestRevisionPerName: true,
		Limit:                 100,
	})
	if err != nil {
		return domain.ReleaseContent{}, fmt.Errorf("list platform flows: %w", err)
	}
	if listedFlows.NextPageToken != "" {
		return domain.ReleaseContent{}, fmt.Errorf("list platform flows: more than one page")
	}
	return domain.ReleaseContent{Schemas: listedSchemas.Items, FlowDefinitions: listedFlows.Items}, nil
}

func releasePointers(pointers []domain.ReleasePointer) []service.CreateReleasePointer {
	out := make([]service.CreateReleasePointer, len(pointers))
	for i, pointer := range pointers {
		out[i] = service.CreateReleasePointer{Kind: pointer.Kind, RevisionID: pointer.RevisionID}
	}
	return out
}
