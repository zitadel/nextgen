package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/zitadel/nextgen/api/openapi/endpoints/flow_definitions"
	"github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	configdefaults "github.com/zitadel/nextgen/packages/config/defaults"
)

// platformDeployPrefix starts the message of a platform deployment, which ends
// in when the server that made it was built.
const platformDeployPrefix = "Platform configuration built "

// maxBuildAttempts bounds how often a start builds the platform release.
const maxBuildAttempts = 3

// EnsureDeployed deploys the platform project the way the CLI deploys any
// project: the configuration this server ships (the platform user schema, the
// default login flows and the recommended password policy) is built into one
// release and deployed to consoleOrigin, the project's one primary origin. It
// runs on every start, so an upgrade's defaults go live. A start that changes
// nothing deploys nothing, and a server built before the one that made the live
// deployment leaves it alone.
func EnsureDeployed(
	ctx context.Context,
	builtinBase string,
	builtAt time.Time,
	consoleOrigin string,
	projects service.ProjectService,
	releases service.ReleaseService,
	deployments *service.DeploymentService,
) error {
	ctx = service.WithAuthzListUnrestricted(ctx)
	live, err := deployments.List(ctx, service.ListDeploymentsInput{ProjectID: domain.PlatformProjectID, Live: true})
	if err != nil {
		return fmt.Errorf("read the platform deployment: %w", err)
	}
	if deployedByNewerBuild(live.Items, builtAt) {
		slog.Info("platform bootstrap: a newer server deployed the platform project")
		return nil
	}

	bundle, err := platformBundle(builtinBase)
	if err != nil {
		return err
	}
	built, err := buildRelease(ctx, releases, bundle)
	if err != nil {
		return fmt.Errorf("build platform release: %w", err)
	}

	// Last, and together: an origin with nothing deployed to it refuses sign-in.
	if err := ownPrimaryOrigin(ctx, projects, consoleOrigin); err != nil {
		return err
	}
	message := platformDeployPrefix + builtAt.UTC().Format(time.RFC3339)
	_, err = deployments.Deploy(ctx, service.DeployInput{
		ProjectID: domain.PlatformProjectID,
		ReleaseID: built.Release.ID,
		Primary:   true,
		Reason:    domain.DeploymentReasonDeploy,
		Message:   &message,
	})
	if errors.Is(err, domain.ErrReleaseRevoked()) {
		// Content someone revoked builds back to that release. What serves now
		// keeps serving, which beats a server that cannot start.
		slog.Warn("platform bootstrap: this server's configuration is a revoked release", slog.String("release_id", built.Release.ID))
		return nil
	}
	if errors.Is(err, domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{})) {
		// Replicas that start together can each mint a schema, so their releases
		// differ and keep replacing each other. Another start is deploying.
		slog.Info("platform bootstrap: another start deployed the platform project")
		return nil
	}
	if err != nil {
		return fmt.Errorf("deploy platform release: %w", err)
	}
	return nil
}

// buildRelease builds bundle, retrying because replicas that start together race
// to store the same revisions: a loser's next build finds what the winner stored.
func buildRelease(ctx context.Context, releases service.ReleaseService, bundle service.BuildReleaseInput) (*service.CreateReleaseOutput, error) {
	for attempt := 1; ; attempt++ {
		built, err := releases.Build(ctx, bundle)
		if err == nil || attempt == maxBuildAttempts {
			return built, err
		}
	}
}

// deployedByNewerBuild reports whether the newest primary deployment came from
// a server built after builtAt: an older binary still starting, in a rollout or
// on an old deployment's own URL, must not take the console back. A build with
// no date, such as a development one, always deploys.
func deployedByNewerBuild(live []*domain.Deployment, builtAt time.Time) bool {
	for _, deployment := range live {
		if deployment.OriginKind != domain.DeploymentOriginKindPrimary {
			continue
		}
		if deployment.Metadata.Message == nil || builtAt.IsZero() {
			return false
		}
		stamp, ok := strings.CutPrefix(*deployment.Metadata.Message, platformDeployPrefix)
		if !ok {
			return false
		}
		deployedBy, err := time.Parse(time.RFC3339, stamp)
		return err == nil && deployedBy.After(builtAt)
	}
	return false
}

// ownPrimaryOrigin makes consoleOrigin the platform project's one primary
// origin: the server owns this project's configuration, and a public base it
// has since left must not stay admitted. Preview origins are left alone.
func ownPrimaryOrigin(ctx context.Context, projects service.ProjectService, consoleOrigin string) error {
	if _, err := projects.AddOrigin(ctx, domain.PlatformProjectID, domain.Origin{Pattern: consoleOrigin, Kind: domain.OriginKindPrimary}); err != nil {
		return fmt.Errorf("add %s to the platform project: %w", consoleOrigin, err)
	}
	project, err := projects.Get(ctx, domain.PlatformProjectID, service.ProjectQueryOptions{})
	if err != nil {
		return fmt.Errorf("read platform project: %w", err)
	}
	for _, origin := range project.Origins {
		if origin.Kind != domain.OriginKindPrimary || origin.Pattern == consoleOrigin {
			continue
		}
		// Every start of a server with another public base would do this too:
		// one database has one public base.
		slog.Warn("platform bootstrap: removing an origin this server's public base replaced", slog.String("origin", origin.Pattern))
		if err := projects.RemoveOrigin(ctx, domain.PlatformProjectID, origin.Pattern); err != nil {
			return fmt.Errorf("remove %s from the platform project: %w", origin.Pattern, err)
		}
	}
	return nil
}

// platformBundle is the configuration this server ships for the platform
// project, as a release bundle: the documents a `.zitadel/` directory would
// hold, so the build stores them under ids it mints, as for any project.
func platformBundle(builtinBase string) (service.BuildReleaseInput, error) {
	schema, err := schemas.PlatformHumanUserSchema(builtinBase)
	if err != nil {
		return service.BuildReleaseInput{}, fmt.Errorf("platform user schema: %w", err)
	}
	flows, err := flow_definitions.DefaultLoginFlowDefinitions(builtinBase, domain.PlatformProjectID)
	if err != nil {
		return service.BuildReleaseInput{}, fmt.Errorf("platform login flows: %w", err)
	}
	var policy struct {
		Operation string         `json:"operation"`
		Config    map[string]any `json:"config"`
	}
	if err := json.Unmarshal(configdefaults.DefaultPasswordPolicy(), &policy); err != nil {
		return service.BuildReleaseInput{}, fmt.Errorf("platform password policy: %w", err)
	}
	bundle := service.BuildReleaseInput{
		ProjectID: domain.PlatformProjectID,
		Schemas:   []service.BuildSchema{{Document: schema}},
		Policies:  []service.BuildPolicy{{Operation: policy.Operation, Config: policy.Config}},
	}
	for i, flow := range flows {
		purposes := make(map[string]string, len(flow.Purposes))
		for purpose, entryStep := range flow.Purposes {
			purposes[purpose.String()] = entryStep
		}
		bundle.FlowDefinitions = append(bundle.FlowDefinitions, service.BuildFlowDefinition{
			Index: i,
			Request: service.FlowDefinitionRequest{
				Name:          flow.Name,
				Status:        flow.Status.String(),
				SchemaVersion: "1.0.0",
				UserSchema:    flow.UserSchema,
				Purposes:      purposes,
				Audience:      flow.Audience,
				Steps:         flow.Steps,
			},
		})
	}
	return bundle, nil
}
