package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"

	"github.com/zitadel/nextgen/api/openapi/endpoints/flow_definitions"
	"github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	configdefaults "github.com/zitadel/nextgen/packages/config/defaults"
)

// platformReleaseMessage is the message the platform release carries.
const platformReleaseMessage = "Platform configuration of this server"

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
// to its primary origins. It runs on every start, so an upgrade's default
// flows go live; a start that changes nothing builds back to the same release
// and deploys nothing.
func EnsureDeployed(
	ctx context.Context,
	builtinBase string,
	consoleOrigin string,
	projects service.ProjectService,
	releases service.ReleaseService,
	deployments *service.DeploymentService,
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

	bundle, err := platformBundle(builtinBase)
	if err != nil {
		return err
	}
	built, err := releases.Build(ctx, bundle)
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

// platformBundle is the configuration this server ships for the platform
// project, as a release bundle: the documents a `.zitadel/` directory would
// hold, so the build stores them under ids it mints, as for any project.
func platformBundle(builtinBase string) (service.BuildReleaseInput, error) {
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
	message := platformReleaseMessage
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
