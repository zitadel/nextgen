package platform

import (
	"context"
	"fmt"
	"slices"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// CheckSeeded reads what EnsureDeployed leaves for a server whose console is
// reached at consoleOrigin, and returns what in it keeps the console from
// signing anyone in; empty when nothing does. project is the platform project
// as the caller read it. It never writes: a server that does not seed reports
// this when it starts, and the next seeding repairs it.
//
// It does not say whose configuration is live. A seeding that changes nothing
// deploys nothing, so the live deployment names the server that first deployed
// its configuration, not the last one that seeded.
func CheckSeeded(ctx context.Context, consoleOrigin string, project *domain.Project, deployments *service.DeploymentService) (string, error) {
	ctx = service.WithAuthzListUnrestricted(ctx)
	live, err := deployments.List(ctx, service.ListDeploymentsInput{ProjectID: domain.PlatformProjectID, Live: true})
	if err != nil {
		return "", fmt.Errorf("read the platform deployment: %w", err)
	}
	return drift(project.Origins, live.Items, consoleOrigin), nil
}

// drift is CheckSeeded over what it read. An origin serves the newest primary
// deployment when that names it and the project still lists it.
func drift(origins []domain.Origin, live []*domain.Deployment, consoleOrigin string) string {
	listed := slices.ContainsFunc(origins, func(origin domain.Origin) bool {
		return origin.Kind == domain.OriginKindPrimary && origin.Pattern == consoleOrigin
	})
	if !listed {
		return fmt.Sprintf("%s, this server's public base, is not one of its primary origins, so the console cannot sign anyone in there", consoleOrigin)
	}
	if primary := primaryDeployment(live); primary == nil || !slices.Contains(primary.Origins(), consoleOrigin) {
		return fmt.Sprintf("nothing is deployed to %s, this server's public base, so the console cannot sign anyone in there", consoleOrigin)
	}
	return ""
}
