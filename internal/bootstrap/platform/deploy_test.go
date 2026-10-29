package platform

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/api/openapi/endpoints/flow_definitions"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const (
	consoleOrigin = "https://console.example.com"
	builtinBase   = "https://example.com/api/schemas"
)

func TestEnsureDeployedBuildsTheServersBundleAndDeploysIt(t *testing.T) {
	projects := &projectStub{}
	releases := &releaseStub{}
	deploys := &deployStub{}

	err := EnsureDeployed(t.Context(), builtinBase, consoleOrigin, projects, releases, deploys)
	require.NoError(t, err)

	assert.Equal(t, []domain.Origin{{Pattern: consoleOrigin, Kind: domain.OriginKindPrimary}}, projects.added)

	defaults, err := flow_definitions.DefaultLoginFlowDefinitions(builtinBase, domain.PlatformProjectID)
	require.NoError(t, err)
	bundle := releases.bundle
	assert.Equal(t, domain.PlatformProjectID, bundle.ProjectID)
	require.Len(t, bundle.Schemas, 1, "the platform user schema")
	assert.Empty(t, bundle.Schemas[0].URL)
	assert.False(t, domain.SchemaDocumentHasTopLevelID(bundle.Schemas[0].Document), "a bundled schema carries no $id")
	require.Len(t, bundle.FlowDefinitions, len(defaults), "the default login flows")
	for i, flow := range bundle.FlowDefinitions {
		assert.Equal(t, defaults[i].Name, flow.Request.Name)
		assert.Equal(t, domain.PlatformProjectID, flow.Request.ProjectID)
	}

	assert.Equal(t, []string{domain.DeploymentTargetPrimary}, deploys.targets)
	assert.Equal(t, "rel_1", deploys.releaseID)
}

func TestEnsureDeployedKeepsAListedOrigin(t *testing.T) {
	projects := &projectStub{origins: []domain.Origin{{Pattern: consoleOrigin, Kind: domain.OriginKindPrimary}}}
	deploys := &deployStub{}

	err := EnsureDeployed(t.Context(), builtinBase, consoleOrigin, projects, &releaseStub{}, deploys)
	require.NoError(t, err)

	assert.Empty(t, projects.added)
	assert.NotEmpty(t, deploys.targets, "it still deploys, which changes nothing when nothing changed")
}

type projectStub struct {
	origins []domain.Origin
	added   []domain.Origin
}

func (s *projectStub) Get(context.Context, string, service.ProjectQueryOptions) (*domain.Project, error) {
	return &domain.Project{ID: domain.PlatformProjectID, Origins: s.origins}, nil
}

func (s *projectStub) AddOrigin(_ context.Context, _ string, origin domain.Origin) (*domain.Origin, error) {
	s.added = append(s.added, origin)
	return &origin, nil
}

type releaseStub struct {
	bundle service.BuildReleaseInput
}

func (s *releaseStub) Build(_ context.Context, input service.BuildReleaseInput) (*service.CreateReleaseOutput, error) {
	s.bundle = input
	return &service.CreateReleaseOutput{Release: &domain.Release{ID: "rel_1"}, Created: true}, nil
}

type deployStub struct {
	releaseID string
	targets   []string
}

func (s *deployStub) Deploy(_ context.Context, input service.DeployInput) (*service.CreateDeploymentOutput, error) {
	s.releaseID = input.ReleaseID
	s.targets = input.Targets
	return &service.CreateDeploymentOutput{Created: true}, nil
}
