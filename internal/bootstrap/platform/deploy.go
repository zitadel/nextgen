package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"golang.org/x/mod/semver"

	"github.com/zitadel/nextgen/api/openapi/endpoints/flow_definitions"
	"github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	configdefaults "github.com/zitadel/nextgen/packages/config/defaults"
)

// platformReleasePrefix starts the platform release's message, which ends in
// the version of the server that built it.
const platformReleasePrefix = "Platform configuration of server "

// platformUserSchema is the platform user schema as a bundle carries it, with
// no $id: a bundled schema is identified by its objectType.
func platformUserSchema(builtinBase string) ([]byte, error) {
	document, err := schemas.PlatformHumanUserSchema(builtinBase)
	if err != nil {
		return nil, fmt.Errorf("platform user schema: %w", err)
	}
	var schema map[string]any
	if err := json.Unmarshal(document, &schema); err != nil {
		return nil, fmt.Errorf("platform user schema: %w", err)
	}
	delete(schema, "$id")
	return json.Marshal(schema)
}

// EnsureDeployed deploys the platform project the way the CLI deploys any
// project: consoleOrigin, where the console signs operators in, is a primary
// origin of it, and the configuration this server ships (the platform user
// schema, the default login flows and the recommended password policy) is
// built into one release and deployed
// to its primary origins. It runs on every start, so an upgrade's defaults go
// live; a start that changes nothing builds back to the same release and
// deploys nothing, and a server older than the one that built the live release
// leaves it alone.
func EnsureDeployed(
	ctx context.Context,
	pool service.StatementPool,
	builtinBase string,
	serverVersion string,
	consoleOrigin string,
	projects service.ProjectService,
	releases service.ReleaseService,
	deployments *service.DeploymentService,
) error {
	ctx = service.WithAuthzListUnrestricted(ctx)
	newer, err := newerServerDeployed(ctx, pool, releases, serverVersion, consoleOrigin)
	if err != nil {
		return err
	}
	if newer {
		slog.Info("platform bootstrap: a newer server deployed the platform project", slog.String("version", serverVersion))
		return nil
	}
	if err := ownPrimaryOrigin(ctx, projects, consoleOrigin); err != nil {
		return err
	}

	bundle, err := platformBundle(builtinBase, serverVersion)
	if err != nil {
		return err
	}
	// Replicas that start together race to store the same revisions. The loser's
	// second build finds what the winner stored.
	built, err := releases.Build(ctx, bundle)
	if err != nil {
		built, err = releases.Build(ctx, bundle)
	}
	if err != nil {
		return fmt.Errorf("build platform release: %w", err)
	}
	if _, err := deployments.Deploy(ctx, service.DeployInput{
		ProjectID: domain.PlatformProjectID,
		ReleaseID: built.Release.ID,
		Targets:   []string{domain.DeploymentTargetPrimary},
		Reason:    domain.DeploymentReasonDeploy,
	}); err != nil {
		return fmt.Errorf("deploy platform release: %w", err)
	}
	return nil
}

// newerServerDeployed reports whether the release the console is served came
// from a server newer than this one: an older binary still starting, in a
// rollout or on an old deployment's own URL, must not take the console back.
func newerServerDeployed(ctx context.Context, pool service.StatementPool, releases service.ReleaseService, serverVersion, consoleOrigin string) (bool, error) {
	serving, err := pool.Statements().GetNewestPerOrigin(ctx, domain.PlatformProjectID, []string{consoleOrigin})
	if err != nil {
		return false, fmt.Errorf("read the platform deployment: %w", err)
	}
	if len(serving) == 0 {
		return false, nil
	}
	live, err := releases.Get(ctx, domain.PlatformProjectID, serving[0].ReleaseID)
	if err != nil {
		return false, fmt.Errorf("read the platform release: %w", err)
	}
	if live.Metadata.Message == nil {
		return false, nil
	}
	liveVersion, ok := strings.CutPrefix(*live.Metadata.Message, platformReleasePrefix)
	return ok && newerVersion(liveVersion, serverVersion), nil
}

// newerVersion reports whether live is a later version than own. A build with
// no version, such as `dev`, compares to nothing, so it always deploys.
func newerVersion(live, own string) bool {
	live, own = "v"+live, "v"+own
	return semver.IsValid(live) && semver.IsValid(own) && semver.Compare(live, own) > 0
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
		if err := projects.RemoveOrigin(ctx, domain.PlatformProjectID, origin.Pattern); err != nil {
			return fmt.Errorf("remove %s from the platform project: %w", origin.Pattern, err)
		}
	}
	return nil
}

// platformBundle is the configuration this server ships for the platform
// project, as a release bundle: the documents a `.zitadel/` directory would
// hold, so the build stores them under ids it mints, as for any project.
func platformBundle(builtinBase, serverVersion string) (service.BuildReleaseInput, error) {
	schema, err := platformUserSchema(builtinBase)
	if err != nil {
		return service.BuildReleaseInput{}, err
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
	message := platformReleasePrefix + serverVersion
	bundle := service.BuildReleaseInput{
		ProjectID: domain.PlatformProjectID,
		Schemas:   []service.BuildSchema{{Index: 0, Document: schema}},
		Policies:  []service.BuildPolicy{{Index: 0, Operation: policy.Operation, Config: policy.Config}},
		Message:   &message,
	}
	for i, flow := range flows {
		purposes := make(map[string]string, len(flow.Purposes))
		for purpose, entryStep := range flow.Purposes {
			purposes[purpose.String()] = entryStep
		}
		bundle.FlowDefinitions = append(bundle.FlowDefinitions, service.BuildFlowDefinition{
			Index: i,
			Request: service.FlowDefinitionRequest{
				ProjectID:     domain.PlatformProjectID,
				Name:          flow.Name,
				Status:        flow.Status.String(),
				SchemaVersion: "1.0.0",
				FlowSchemaURI: configdefaults.DefaultFlowSchemaURI,
				UserSchema:    flow.UserSchema,
				Purposes:      purposes,
				Audience:      flow.Audience,
				Steps:         flow.Steps,
			},
		})
	}
	return bundle, nil
}
