package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const appOrigin = "https://app.acme.com"

var deployedAt = time.Date(2026, 10, 2, 14, 52, 0, 0, time.UTC)

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
		ProjectID:  "proj_1",
		ReleaseID:  "rel_1",
		TargetKind: domain.DeploymentTargetKindPrimary,
		Origins:    []string{appOrigin},
	}
}

// expectServing sets up the reads of one attempt: the release, and what
// appOrigin serves (nothing when serving is nil). It returns what was read.
func expectServing(statements *servicemocks.MockAllStatements, serving *domain.Deployment) []domain.TargetDeployment {
	statements.EXPECT().GetReleaseByID(gomock.Any(), "proj_1", "rel_1").Return(&domain.Release{ID: "rel_1"}, nil)
	if serving == nil {
		statements.EXPECT().NewestTargets(gomock.Any(), "proj_1", []string{appOrigin}).Return(nil, nil)
		return nil
	}
	read := []domain.TargetDeployment{{
		Origin: appOrigin, DeploymentID: serving.ID, ReleaseID: serving.ReleaseID, DeployedAt: serving.DeployedAt, Seq: 7,
	}}
	statements.EXPECT().NewestTargets(gomock.Any(), "proj_1", []string{appOrigin}).Return(read, nil)
	statements.EXPECT().GetDeploymentByID(gomock.Any(), "proj_1", serving.ID).Return(serving, nil)
	return read
}

func expectInsert(statements *servicemocks.MockAllStatements, read []domain.TargetDeployment) {
	statements.EXPECT().InsertDeployment(gomock.Any(), gomock.Any(), read).
		DoAndReturn(func(_ context.Context, entity *domain.Deployment, _ []domain.TargetDeployment) error {
			entity.ID = "dep_new"
			entity.DeployedAt = deployedAt
			return nil
		})
}

func servingDeployment(releaseID string) *domain.Deployment {
	return &domain.Deployment{
		ProjectID: "proj_1", ID: "dep_serving", ReleaseID: releaseID,
		TargetKind: domain.DeploymentTargetKindPrimary,
		Targets:    []domain.DeploymentTarget{{Origin: appOrigin}},
		DeployedAt: deployedAt.Add(-time.Hour),
	}
}

func TestDeploymentServiceCreateRecordsActor(t *testing.T) {
	svc, statements := newMockedDeploymentService(t)
	expectInsert(statements, expectServing(statements, nil))

	ctx := audit.WithActorContext(t.Context(), audit.ActorContext{
		ActorID:   new("user_1"),
		ActorType: new(domain.EventActorTypeHuman),
	})
	result, err := svc.Create(ctx, deploymentInput())
	require.NoError(t, err)
	assert.True(t, result.Created)
	assert.Equal(t, "dep_new", result.Deployment.ID)
	assert.Equal(t, "user_1", *result.Deployment.Metadata.DeployedBy)
	assert.Equal(t, domain.EventActorTypeHuman, *result.Deployment.Metadata.DeployedByType)
}

func TestDeploymentServiceCreateWithoutActor(t *testing.T) {
	svc, statements := newMockedDeploymentService(t)
	expectInsert(statements, expectServing(statements, nil))

	result, err := svc.Create(t.Context(), deploymentInput())
	require.NoError(t, err)
	assert.Nil(t, result.Deployment.Metadata.DeployedBy)
	assert.Nil(t, result.Deployment.Metadata.DeployedByType)
}

// The insert gets what was read: that is the optimistic lock.
func TestDeploymentServiceCreateInsertsAgainstWhatItRead(t *testing.T) {
	svc, statements := newMockedDeploymentService(t)
	read := expectServing(statements, servingDeployment("rel_0"))
	expectInsert(statements, read)

	result, err := svc.Create(t.Context(), deploymentInput())
	require.NoError(t, err)
	assert.True(t, result.Created)
}

// Losing the optimistic lock retries on what the winner left.
func TestDeploymentServiceCreateRetriesALostLock(t *testing.T) {
	t.Run("unguarded deploy writes on the retry", func(t *testing.T) {
		svc, statements := newMockedDeploymentService(t)
		expectServing(statements, nil)
		statements.EXPECT().InsertDeployment(gomock.Any(), gomock.Any(), gomock.Any()).Return(new(database.UniqueError))
		read := expectServing(statements, servingDeployment("rel_0"))
		expectInsert(statements, read)

		result, err := svc.Create(t.Context(), deploymentInput())
		require.NoError(t, err)
		assert.True(t, result.Created)
	})

	t.Run("guarded deploy answers a conflict on the retry", func(t *testing.T) {
		svc, statements := newMockedDeploymentService(t)
		before := servingDeployment("rel_0")
		before.ID = "dep_before"
		expectServing(statements, before)
		statements.EXPECT().InsertDeployment(gomock.Any(), gomock.Any(), gomock.Any()).Return(new(database.UniqueError))
		winner := servingDeployment("rel_0")
		expectServing(statements, winner)

		input := deploymentInput()
		input.ExpectedDeploymentID = new("dep_before")
		_, err := svc.Create(t.Context(), input)
		de := assertServiceDomainCode(t, err, domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{}).Code)
		assert.Equal(t, domain.DeploymentConflictDetails{Deployment: winner}, de.Details)
	})

	t.Run("gives up with a conflict", func(t *testing.T) {
		svc, statements := newMockedDeploymentService(t)
		for range 3 {
			expectServing(statements, nil)
			statements.EXPECT().InsertDeployment(gomock.Any(), gomock.Any(), gomock.Any()).Return(new(database.UniqueError))
		}
		winner := servingDeployment("rel_0")
		statements.EXPECT().NewestTargets(gomock.Any(), "proj_1", []string{appOrigin}).Return([]domain.TargetDeployment{{
			Origin: appOrigin, DeploymentID: winner.ID, DeployedAt: winner.DeployedAt, Seq: 9,
		}}, nil)
		statements.EXPECT().GetDeploymentByID(gomock.Any(), "proj_1", winner.ID).Return(winner, nil)

		_, err := svc.Create(t.Context(), deploymentInput())
		de := assertServiceDomainCode(t, err, domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{}).Code)
		assert.Equal(t, domain.DeploymentConflictDetails{Deployment: winner}, de.Details)
	})
}

// Deploying to primary origins that all serve the release writes nothing and
// answers with what they serve.
func TestDeploymentServiceCreateUnchangedPrimaryWritesNothing(t *testing.T) {
	svc, statements := newMockedDeploymentService(t)
	serving := servingDeployment("rel_1")
	expectServing(statements, serving)

	result, err := svc.Create(t.Context(), deploymentInput())
	require.NoError(t, err)
	assert.False(t, result.Created)
	assert.Same(t, serving, result.Deployment)
}

// A preview deploy is always written, and renews the previews from its stamp.
func TestDeploymentServiceCreatePreviewAlwaysRenews(t *testing.T) {
	svc, statements := newMockedDeploymentService(t)
	serving := servingDeployment("rel_1")
	serving.TargetKind = domain.DeploymentTargetKindPreview
	read := expectServing(statements, serving)
	expectInsert(statements, read)
	statements.EXPECT().UpsertPreviews(gomock.Any(), "proj_1", []string{appOrigin}, deployedAt.Add(168*time.Hour), deployedAt).Return(nil)

	input := deploymentInput()
	input.TargetKind = domain.DeploymentTargetKindPreview
	input.PreviewTTL = 168 * time.Hour
	result, err := svc.Create(t.Context(), input)
	require.NoError(t, err)
	assert.True(t, result.Created)
}

func TestDeploymentServiceCreateGuard(t *testing.T) {
	t.Run("matching", func(t *testing.T) {
		svc, statements := newMockedDeploymentService(t)
		serving := servingDeployment("rel_0")
		expectInsert(statements, expectServing(statements, serving))

		input := deploymentInput()
		input.ExpectedDeploymentID = new(serving.ID)
		_, err := svc.Create(t.Context(), input)
		require.NoError(t, err)
	})

	t.Run("mismatch carries what is served", func(t *testing.T) {
		svc, statements := newMockedDeploymentService(t)
		serving := servingDeployment("rel_0")
		expectServing(statements, serving)

		input := deploymentInput()
		input.ExpectedDeploymentID = new("dep_stale")
		_, err := svc.Create(t.Context(), input)
		de := assertServiceDomainCode(t, err, domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{}).Code)
		assert.Equal(t, domain.DeploymentConflictDetails{Deployment: serving}, de.Details)
	})

	// A stale guard is refused even when the deploy would change nothing.
	t.Run("checked before the no-op", func(t *testing.T) {
		svc, statements := newMockedDeploymentService(t)
		expectServing(statements, servingDeployment("rel_1"))

		input := deploymentInput()
		input.ExpectedDeploymentID = new("dep_stale")
		_, err := svc.Create(t.Context(), input)
		assertServiceDomainCode(t, err, domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{}).Code)
	})

	t.Run("nothing deployed yet", func(t *testing.T) {
		svc, statements := newMockedDeploymentService(t)
		expectServing(statements, nil)

		input := deploymentInput()
		input.ExpectedDeploymentID = new("dep_any")
		_, err := svc.Create(t.Context(), input)
		de := assertServiceDomainCode(t, err, domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{}).Code)
		assert.Equal(t, domain.DeploymentConflictDetails{}, de.Details)
	})
}

func TestDeploymentServiceCreateErrorMapping(t *testing.T) {
	t.Run("release missing", func(t *testing.T) {
		svc, statements := newMockedDeploymentService(t)
		statements.EXPECT().GetReleaseByID(gomock.Any(), "proj_1", "rel_1").Return(nil, new(database.NoRowFoundError))

		_, err := svc.Create(t.Context(), deploymentInput())
		assertServiceDomainCode(t, err, domain.ErrReleaseNotFound().Code)
	})

	// The release was read first, so a foreign key failing on insert is the
	// project.
	t.Run("project missing", func(t *testing.T) {
		svc, statements := newMockedDeploymentService(t)
		expectServing(statements, nil)
		statements.EXPECT().InsertDeployment(gomock.Any(), gomock.Any(), gomock.Any()).Return(new(database.ForeignKeyError))

		_, err := svc.Create(t.Context(), deploymentInput())
		assertServiceDomainCode(t, err, domain.ErrProjectNotFound().Code)
	})

	t.Run("invalid input never reaches storage", func(t *testing.T) {
		svc, _ := newMockedDeploymentService(t)
		input := deploymentInput()
		input.Reason = domain.DeploymentReasonRollback
		_, err := svc.Create(t.Context(), input)
		assertServiceDomainCode(t, err, domain.ErrDeploymentInvalid(nil, nil).Code)
	})

	t.Run("preview without ttl never reaches storage", func(t *testing.T) {
		svc, _ := newMockedDeploymentService(t)
		input := deploymentInput()
		input.TargetKind = domain.DeploymentTargetKindPreview
		_, err := svc.Create(t.Context(), input)
		assertServiceDomainCode(t, err, domain.ErrDeploymentInvalid(nil, nil).Code)
	})
}

func assertServiceDomainCode(t *testing.T, err error, code string) domain.Error {
	t.Helper()
	require.Error(t, err)
	de, ok := err.(domain.Error)
	require.True(t, ok, "expected a domain error, got %T", err)
	assert.Equal(t, code, de.Code)
	return de
}

// Expanding hydrates the page's releases in one batched, deduplicated read.
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

// Not asking reads nothing and leaves the map nil.
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
