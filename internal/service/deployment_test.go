package service_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func newMockedDeploymentService(t *testing.T) (*service.DeploymentService, *servicemocks.MockAllStatements) {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	pool.EXPECT().
		Transaction(gomock.Any(), gomock.Any()).
		DoAndReturn(func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, statementer)
		}).
		AnyTimes()
	statementer.EXPECT().Statements().Return(statements).AnyTimes()
	statements.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	return service.NewDeploymentService(service.NewPool(pool)), statements
}

func deploymentInput() service.CreateDeploymentInput {
	return service.CreateDeploymentInput{
		ProjectID:     "proj_1",
		EnvironmentID: "env_1",
		ReleaseID:     "rel_1",
		Reason:        domain.DeploymentReasonDeploy,
	}
}

func TestDeploymentServiceCreateRecordsActor(t *testing.T) {
	svc, statements := newMockedDeploymentService(t)
	statements.EXPECT().CreateDeployment(gomock.Any(), gomock.Any(), gomock.Nil()).Return(true, nil)

	ctx := audit.WithActorContext(t.Context(), audit.ActorContext{
		ActorID:   new("user_1"),
		ActorType: new(domain.EventActorTypeHuman),
	})
	result, err := svc.Create(ctx, deploymentInput())
	require.NoError(t, err)
	assert.True(t, result.Created)
	assert.Equal(t, "user_1", *result.Deployment.Metadata.DeployedBy)
	assert.Equal(t, domain.EventActorTypeHuman, *result.Deployment.Metadata.DeployedByType)
}

// A deployment made with no actor on the context — a project secret from CI —
// records neither field, rather than falling back to a placeholder identity.
func TestDeploymentServiceCreateWithoutActor(t *testing.T) {
	svc, statements := newMockedDeploymentService(t)
	statements.EXPECT().CreateDeployment(gomock.Any(), gomock.Any(), gomock.Nil()).Return(true, nil)

	result, err := svc.Create(t.Context(), deploymentInput())
	require.NoError(t, err)
	assert.Nil(t, result.Deployment.Metadata.DeployedBy)
	assert.Nil(t, result.Deployment.Metadata.DeployedByType)
}

// The guard rides through to the statement untouched and unpersisted.
func TestDeploymentServiceCreatePassesExpectedCurrent(t *testing.T) {
	svc, statements := newMockedDeploymentService(t)
	expected := "dep_current"
	statements.EXPECT().
		CreateDeployment(gomock.Any(), gomock.Any(), &expected).
		Return(true, nil)

	input := deploymentInput()
	input.ExpectedCurrentDeploymentID = &expected
	_, err := svc.Create(t.Context(), input)
	require.NoError(t, err)
}

func TestDeploymentServiceCreateErrorMapping(t *testing.T) {
	t.Run("environment missing", func(t *testing.T) {
		svc, statements := newMockedDeploymentService(t)
		statements.EXPECT().
			CreateDeployment(gomock.Any(), gomock.Any(), gomock.Nil()).
			Return(false, new(database.NoRowFoundError))

		_, err := svc.Create(t.Context(), deploymentInput())
		assertServiceDomainCode(t, err, domain.ErrEnvironmentNotFound().Code)
	})

	t.Run("release missing", func(t *testing.T) {
		svc, statements := newMockedDeploymentService(t)
		statements.EXPECT().
			CreateDeployment(gomock.Any(), gomock.Any(), gomock.Nil()).
			Return(false, new(database.ForeignKeyError))

		_, err := svc.Create(t.Context(), deploymentInput())
		assertServiceDomainCode(t, err, domain.ErrDeploymentInvalid(nil, nil).Code)
	})

	// The conflict is raised inside the statement with its details attached;
	// the service must hand it through rather than rewrap it.
	t.Run("conflict passes through", func(t *testing.T) {
		svc, statements := newMockedDeploymentService(t)
		conflict := domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{
			CurrentDeploymentID: "dep_actual",
			CurrentReleaseID:    "rel_actual",
		})
		statements.EXPECT().
			CreateDeployment(gomock.Any(), gomock.Any(), gomock.Nil()).
			Return(false, conflict)

		_, err := svc.Create(t.Context(), deploymentInput())
		de, ok := err.(domain.Error)
		require.True(t, ok, "expected a domain error, got %T", err)
		assert.Equal(t, conflict.Code, de.Code)
		assert.Equal(t, conflict.Details, de.Details)
	})

	// Validation fails before any statement runs: promote without a source
	// never reaches storage.
	t.Run("invalid input never reaches storage", func(t *testing.T) {
		svc, _ := newMockedDeploymentService(t)
		input := deploymentInput()
		input.Reason = domain.DeploymentReasonPromote
		_, err := svc.Create(t.Context(), input)
		assertServiceDomainCode(t, err, domain.ErrDeploymentInvalid(nil, nil).Code)
	})
}

func assertServiceDomainCode(t *testing.T, err error, code string) {
	t.Helper()
	require.Error(t, err)
	de, ok := err.(domain.Error)
	require.True(t, ok, "expected a domain error, got %T", err)
	assert.Equal(t, code, de.Code)
}

// Expanding hydrates the page's releases in one batched, deduplicated read —
// a history is many deployments of few releases.
func TestDeploymentServiceListExpandsReleases(t *testing.T) {
	svc, statements := newMockedDeploymentService(t)

	items := []*domain.Deployment{
		{ProjectID: "proj_1", ID: "dep_1", ReleaseID: "rel_a"},
		{ProjectID: "proj_1", ID: "dep_2", ReleaseID: "rel_b"},
		{ProjectID: "proj_1", ID: "dep_3", ReleaseID: "rel_a"},
	}
	statements.EXPECT().
		ListDeployments(gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.Deployment]{Items: items}, nil)
	statements.EXPECT().
		GetReleasesByIDs(gomock.Any(), "proj_1", []string{"rel_a", "rel_b"}).
		Return([]*domain.Release{
			{ProjectID: "proj_1", ID: "rel_a"},
			{ProjectID: "proj_1", ID: "rel_b"},
		}, nil)

	result, err := svc.List(t.Context(), service.ListDeploymentsInput{
		ProjectID:       "proj_1",
		IncludeReleases: true,
	})
	require.NoError(t, err)
	require.Len(t, result.ReleasesByID, 2)
	assert.Equal(t, "rel_a", result.ReleasesByID["rel_a"].ID)
}

// Not asking reads nothing: no release round trip, and a nil map so the
// handler can distinguish "did not ask" from "none found".
func TestDeploymentServiceListWithoutExpand(t *testing.T) {
	svc, statements := newMockedDeploymentService(t)
	statements.EXPECT().
		ListDeployments(gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.Deployment]{Items: []*domain.Deployment{
			{ProjectID: "proj_1", ID: "dep_1", ReleaseID: "rel_a"},
		}}, nil)

	result, err := svc.List(t.Context(), service.ListDeploymentsInput{ProjectID: "proj_1"})
	require.NoError(t, err)
	assert.Nil(t, result.ReleasesByID)
}

// The idempotent answer reports Created false, so the handler can answer 200
// with the deployment that made the release live.
func TestDeploymentServiceCreateReportsReuse(t *testing.T) {
	svc, statements := newMockedDeploymentService(t)
	statements.EXPECT().
		CreateDeployment(gomock.Any(), gomock.Any(), gomock.Nil()).
		Return(false, nil)

	result, err := svc.Create(t.Context(), deploymentInput())
	require.NoError(t, err)
	assert.False(t, result.Created)
}
