package platform

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
)

func TestEnsureDefaultTargetSkipsWhenOneServes(t *testing.T) {
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockStatementPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(stmts)
	stmts.EXPECT().GetNewestPerOrigin(gomock.Any(), domain.PlatformProjectID, []string{domain.DefaultTargetOrigin}).
		Return([]domain.OriginDeployment{{DeploymentID: "dep_1"}}, nil)

	err := EnsureDefaultTarget(t.Context(), pool, schemaStub{}, flowStub{}, &releaseStub{}, &deployStub{})
	require.NoError(t, err)
}

func TestEnsureDefaultTargetDeploysTheCatalog(t *testing.T) {
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockStatementPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(stmts)
	stmts.EXPECT().GetNewestPerOrigin(gomock.Any(), domain.PlatformProjectID, []string{domain.DefaultTargetOrigin}).
		Return(nil, nil)

	objectType := "human-user"
	schemas := schemaStub{items: []*domain.JSONSchema{{URL: "https://example.test/human.json", ObjectType: &objectType}}}
	flows := flowStub{items: []*domain.FlowDefinition{{ID: "flowdef_1", Name: "default-login"}}}
	releases := &releaseStub{}
	deploys := &deployStub{}

	err := EnsureDefaultTarget(t.Context(), pool, schemas, flows, releases, deploys)
	require.NoError(t, err)
	require.Len(t, releases.pointers, 2)
	assert.Equal(t, domain.PlatformProjectID, releases.projectID)
	assert.Equal(t, []string{domain.DeploymentTargetDefault}, deploys.targets)
	assert.Equal(t, releases.id, deploys.releaseID)
}

func TestEnsureDefaultTargetSkipsAnEmptyCatalog(t *testing.T) {
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockStatementPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(stmts)
	stmts.EXPECT().GetNewestPerOrigin(gomock.Any(), domain.PlatformProjectID, []string{domain.DefaultTargetOrigin}).
		Return(nil, nil)

	err := EnsureDefaultTarget(t.Context(), pool, schemaStub{}, flowStub{}, &releaseStub{}, &deployStub{})
	require.NoError(t, err)
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
