package platform

import (
	"context"
	"fmt"
	"slices"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// Catalog lists what the platform release pins, each at its newest revision.
type Catalog struct {
	Schemas interface {
		ListSchemas(ctx context.Context, input service.ListSchemasInput) (*service.ListSchemasOutput, error)
	}
	Flows interface {
		List(ctx context.Context, req service.ListFlowDefinitionsRequest) (*service.ListFlowDefinitionsResponse, error)
	}
	IDPConnections interface {
		List(ctx context.Context, input service.ListIDPConnectionsInput) (*service.ListIDPConnectionsOutput, error)
	}
	Policies interface {
		List(ctx context.Context, input service.ListPoliciesInput) (*service.ListPoliciesOutput, error)
	}
	Branding interface {
		GetLatest(ctx context.Context, projectID string) (*domain.Branding, error)
	}
}

// originRegistry reads the platform project and adds an origin to it.
type originRegistry interface {
	Get(ctx context.Context, id string, opts service.ProjectQueryOptions) (*domain.Project, error)
	AddOrigin(ctx context.Context, projectID string, origin domain.Origin) (*domain.Origin, error)
}

// releasePublisher creates the release the platform project serves.
type releasePublisher interface {
	Create(ctx context.Context, input service.CreateReleaseInput) (*service.CreateReleaseOutput, error)
}

// targetDeployer deploys that release.
type targetDeployer interface {
	Deploy(ctx context.Context, input service.DeployInput) (*service.CreateDeploymentOutput, error)
}

// EnsureDeployed makes the platform project serve its current configuration,
// like any project the CLI deploys: consoleOrigin, where the console signs
// operators in, is a primary origin of it, and a release of every kind's
// newest revision is deployed to its primary origins.
// It runs on every start, so an upgrade's new defaults go live; a deploy that
// changes nothing writes nothing.
func EnsureDeployed(
	ctx context.Context,
	consoleOrigin string,
	projects originRegistry,
	catalog Catalog,
	releases releasePublisher,
	deployments targetDeployer,
) error {
	ctx = service.WithAuthzListUnrestricted(ctx)
	project, err := projects.Get(ctx, domain.PlatformProjectID, service.ProjectQueryOptions{})
	if err != nil {
		return fmt.Errorf("read platform project: %w", err)
	}
	listed := slices.ContainsFunc(project.Origins, func(origin domain.Origin) bool { return origin.Pattern == consoleOrigin })
	if !listed {
		if _, err := projects.AddOrigin(ctx, domain.PlatformProjectID, domain.Origin{Pattern: consoleOrigin, Kind: domain.OriginKindPrimary}); err != nil {
			return fmt.Errorf("add %s to the platform project: %w", consoleOrigin, err)
		}
	}

	content, err := platformContent(ctx, catalog)
	if err != nil {
		return err
	}
	pointers, err := content.Pointers()
	if err != nil {
		return fmt.Errorf("pin platform release: %w", err)
	}
	if len(pointers) == 0 {
		return nil
	}
	created, err := releases.Create(ctx, service.CreateReleaseInput{
		ProjectID: domain.PlatformProjectID,
		Pointers:  releasePointers(pointers),
	})
	if err != nil {
		return fmt.Errorf("release platform project: %w", err)
	}
	if _, err := deployments.Deploy(ctx, service.DeployInput{
		ProjectID: domain.PlatformProjectID,
		ReleaseID: created.Release.ID,
		Targets:   []string{domain.DeploymentTargetPrimary},
		Reason:    domain.DeploymentReasonDeploy,
	}); err != nil {
		return fmt.Errorf("deploy platform project: %w", err)
	}
	return nil
}

func platformContent(ctx context.Context, catalog Catalog) (domain.ReleaseContent, error) {
	const limit = 100
	schemas, err := catalog.Schemas.ListSchemas(ctx, service.ListSchemasInput{
		ProjectID:                   domain.PlatformProjectID,
		LatestRevisionPerObjectType: true,
		Limit:                       limit,
	})
	if err != nil {
		return domain.ReleaseContent{}, fmt.Errorf("list platform schemas: %w", err)
	}
	flows, err := catalog.Flows.List(ctx, service.ListFlowDefinitionsRequest{
		ProjectID:             domain.PlatformProjectID,
		LatestRevisionPerName: true,
		Limit:                 limit,
	})
	if err != nil {
		return domain.ReleaseContent{}, fmt.Errorf("list platform flows: %w", err)
	}
	idps, err := catalog.IDPConnections.List(ctx, service.ListIDPConnectionsInput{ProjectID: domain.PlatformProjectID, Limit: limit})
	if err != nil {
		return domain.ReleaseContent{}, fmt.Errorf("list platform identity providers: %w", err)
	}
	policies, err := catalog.Policies.List(ctx, service.ListPoliciesInput{ProjectID: domain.PlatformProjectID, Limit: limit})
	if err != nil {
		return domain.ReleaseContent{}, fmt.Errorf("list platform policies: %w", err)
	}
	if schemas.NextPageToken != "" || flows.NextPageToken != "" || idps.NextPageToken != "" || policies.NextPageToken != "" {
		return domain.ReleaseContent{}, fmt.Errorf("list platform configuration: more than %d of a kind", limit)
	}
	branding, err := catalog.Branding.GetLatest(ctx, domain.PlatformProjectID)
	if err != nil {
		return domain.ReleaseContent{}, fmt.Errorf("read platform branding: %w", err)
	}
	return domain.ReleaseContent{
		Schemas:         schemas.Items,
		FlowDefinitions: flows.Items,
		IDPConnections:  idps.Items,
		Policies:        policies.Items,
		Branding:        branding,
	}, nil
}

func releasePointers(pointers []domain.ReleasePointer) []service.CreateReleasePointer {
	out := make([]service.CreateReleasePointer, len(pointers))
	for i, pointer := range pointers {
		out[i] = service.CreateReleasePointer{Kind: pointer.Kind, RevisionID: pointer.RevisionID}
	}
	return out
}
