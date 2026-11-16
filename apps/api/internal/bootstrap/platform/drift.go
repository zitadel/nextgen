package platform

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// Drift is one way the platform project differs from what a seeding with a
// server's configuration leaves. A server that does not seed reports it when
// it starts: it cannot repair it, the next seeding does.
type Drift struct {
	// Breaking is drift the console cannot sign in through. The rest serves
	// configuration an older server shipped.
	Breaking bool
	Message  string
}

// CheckSeeded reads what EnsureDeployed leaves and returns how it differs for
// a server built at builtAt whose console is reached at consoleOrigin.
// project is the platform project as the caller read it. It never writes.
func CheckSeeded(ctx context.Context, builtAt time.Time, consoleOrigin string, project *domain.Project, deployments *service.DeploymentService) ([]Drift, error) {
	ctx = service.WithAuthzListUnrestricted(ctx)
	live, err := deployments.List(ctx, service.ListDeploymentsInput{ProjectID: domain.PlatformProjectID, Live: true})
	if err != nil {
		return nil, fmt.Errorf("read the platform deployment: %w", err)
	}
	return drift(project.Origins, live.Items, builtAt, consoleOrigin), nil
}

// drift compares the platform project's origins and live deployments with
// what a seeding by a server built at builtAt, for consoleOrigin, leaves. An
// origin serves the newest primary deployment when that names it and the
// project still lists it.
func drift(origins []domain.Origin, live []*domain.Deployment, builtAt time.Time, consoleOrigin string) []Drift {
	listed := slices.ContainsFunc(origins, func(origin domain.Origin) bool {
		return origin.Kind == domain.OriginKindPrimary && origin.Pattern == consoleOrigin
	})
	if !listed {
		return []Drift{{
			Breaking: true,
			Message:  fmt.Sprintf("%s, this server's public base, is not one of its primary origins, so the console cannot sign anyone in there", consoleOrigin),
		}}
	}
	primary := primaryDeployment(live)
	if primary == nil || !slices.Contains(primary.Origins(), consoleOrigin) {
		return []Drift{{
			Breaking: true,
			Message:  fmt.Sprintf("nothing is deployed to %s, this server's public base, so the console cannot sign anyone in there", consoleOrigin),
		}}
	}
	if deployedBy, ok := deployedByBuild(primary); ok && !builtAt.IsZero() && deployedBy.Before(builtAt) {
		return []Drift{{
			Message: fmt.Sprintf("it serves the configuration of a server built %s, older than this one's (%s)",
				deployedBy.UTC().Format(time.RFC3339), builtAt.UTC().Format(time.RFC3339)),
		}}
	}
	return nil
}
