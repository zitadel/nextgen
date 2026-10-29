package platform

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const consoleOrigin = "https://console.example.com"

func TestEnsureDeployedAddsTheConsoleOriginAndDeploysEveryKind(t *testing.T) {
	projects := &projectStub{}
	releases := &releaseStub{}
	deploys := &deployStub{}

	err := EnsureDeployed(t.Context(), consoleOrigin, projects, fullCatalog(), releases, deploys)
	require.NoError(t, err)

	assert.Equal(t, []domain.Origin{{Pattern: consoleOrigin, Kind: domain.OriginKindPrimary}}, projects.added)
	kinds := make([]domain.ReleasePointerKind, 0, len(releases.pointers))
	for _, pointer := range releases.pointers {
		kinds = append(kinds, pointer.Kind)
	}
	assert.ElementsMatch(t, []domain.ReleasePointerKind{
		domain.ReleasePointerKindSchema,
		domain.ReleasePointerKindFlowDefinition,
		domain.ReleasePointerKindIDP,
		domain.ReleasePointerKindPolicy,
		domain.ReleasePointerKindBranding,
	}, kinds)
	assert.Equal(t, domain.PlatformProjectID, releases.projectID)
	assert.Equal(t, []string{domain.DeploymentTargetPrimary}, deploys.targets)
	assert.Equal(t, releases.id, deploys.releaseID)
}

func TestEnsureDeployedKeepsAListedOrigin(t *testing.T) {
	projects := &projectStub{origins: []domain.Origin{{Pattern: consoleOrigin, Kind: domain.OriginKindPrimary}}}
	deploys := &deployStub{}

	err := EnsureDeployed(t.Context(), consoleOrigin, projects, fullCatalog(), &releaseStub{}, deploys)
	require.NoError(t, err)

	assert.Empty(t, projects.added)
	assert.NotEmpty(t, deploys.targets, "it still deploys, which changes nothing when nothing changed")
}

func TestEnsureDeployedDeploysNothingWithoutConfiguration(t *testing.T) {
	deploys := &deployStub{}

	err := EnsureDeployed(t.Context(), consoleOrigin, &projectStub{}, Catalog{
		Schemas:        schemaStub{},
		Flows:          flowStub{},
		IDPConnections: idpStub{},
		Policies:       policyStub{},
		Branding:       brandingStub{},
	}, &releaseStub{}, deploys)
	require.NoError(t, err)

	assert.Empty(t, deploys.targets)
}

func fullCatalog() Catalog {
	objectType := "human-user"
	return Catalog{
		Schemas:        schemaStub{items: []*domain.JSONSchema{{URL: "https://example.test/human.json", ObjectType: &objectType}}},
		Flows:          flowStub{items: []*domain.FlowDefinition{{ID: "flowdef_1", Name: "default-login"}}},
		IDPConnections: idpStub{items: []*domain.IDPConnection{{Slug: "google", RevisionID: "idprev_1"}}},
		Policies:       policyStub{items: []*domain.Policy{{Operation: "auth.factor.password.set", RevisionID: "polrev_1"}}},
		Branding:       brandingStub{branding: &domain.Branding{ID: "brand_1"}},
	}
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

type schemaStub struct {
	items []*domain.JSONSchema
}

func (s schemaStub) ListSchemas(context.Context, service.ListSchemasInput) (*service.ListSchemasOutput, error) {
	return &service.ListSchemasOutput{Items: s.items}, nil
}

type flowStub struct {
	items []*domain.FlowDefinition
}

func (s flowStub) List(context.Context, service.ListFlowDefinitionsRequest) (*service.ListFlowDefinitionsResponse, error) {
	return &service.ListFlowDefinitionsResponse{Items: s.items}, nil
}

type idpStub struct {
	items []*domain.IDPConnection
}

func (s idpStub) List(context.Context, service.ListIDPConnectionsInput) (*service.ListIDPConnectionsOutput, error) {
	return &service.ListIDPConnectionsOutput{Items: s.items}, nil
}

type policyStub struct {
	items []*domain.Policy
}

func (s policyStub) List(context.Context, service.ListPoliciesInput) (*service.ListPoliciesOutput, error) {
	return &service.ListPoliciesOutput{Items: s.items}, nil
}

type brandingStub struct {
	branding *domain.Branding
}

func (s brandingStub) GetLatest(context.Context, string) (*domain.Branding, error) {
	return s.branding, nil
}

type releaseStub struct {
	projectID string
	pointers  []service.CreateReleasePointer
	id        string
}

func (s *releaseStub) Create(_ context.Context, input service.CreateReleaseInput) (*service.CreateReleaseOutput, error) {
	s.projectID = input.ProjectID
	s.pointers = input.Pointers
	s.id = "rel_1"
	return &service.CreateReleaseOutput{Release: &domain.Release{ID: s.id}, Created: true}, nil
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
