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
		OriginKind: domain.DeploymentOriginKindPrimary,
		Origins:    []string{appOrigin},
	}
}

// expectServing sets up the reads of one primary attempt: the release, what
// appOrigin last received (nothing when serving is nil), and the project's
// newest primary deployment. It returns what was read for the lock.
func expectServing(statements *servicemocks.MockAllStatements, serving *domain.Deployment) []domain.OriginDeployment {
	statements.EXPECT().GetReleaseByID(gomock.Any(), "proj_1", "rel_1").Return(&domain.Release{ID: "rel_1"}, nil)
	var read []domain.OriginDeployment
	if serving != nil {
		read = []domain.OriginDeployment{{
			Origin: appOrigin, DeploymentID: serving.ID, ReleaseID: serving.ReleaseID, Kind: serving.OriginKind,
			DeployedAt: serving.DeployedAt, Seq: 7,
		}}
	}
	statements.EXPECT().GetNewestPerOrigin(gomock.Any(), "proj_1", []string{appOrigin}).Return(read, nil)
	newest := &database.ListResult[*domain.Deployment]{}
	if serving != nil && serving.OriginKind == domain.DeploymentOriginKindPrimary {
		newest.Items = []*domain.Deployment{serving}
	}
	statements.EXPECT().ListDeployments(unrestricted, gomock.Any()).Return(newest, nil)
	return read
}

// unrestricted matches the context of a lookup that is not the caller's
// list, so it must not carry the caller's authz list filter.
var unrestricted = gomock.Cond(func(ctx context.Context) bool { return service.AuthzListUnrestricted(ctx) })

func expectInsert(statements *servicemocks.MockAllStatements, read []domain.OriginDeployment) {
	statements.EXPECT().CreateDeployment(gomock.Any(), gomock.Any(), read).
		DoAndReturn(func(_ context.Context, entity *domain.Deployment, _ []domain.OriginDeployment) error {
			entity.ID = "dep_new"
			entity.DeployedAt = deployedAt
			return nil
		})
}

func servingDeployment(releaseID string) *domain.Deployment {
	return &domain.Deployment{
		ProjectID: "proj_1", ID: "dep_serving", ReleaseID: releaseID,
		OriginKind: domain.DeploymentOriginKindPrimary,
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

// Losing the optimistic lock: an unguarded deploy retries on what the winner
// left, a guarded one answers a conflict.
func TestDeploymentServiceCreateRetriesALostLock(t *testing.T) {
	t.Run("unguarded deploy writes on the retry", func(t *testing.T) {
		svc, statements := newMockedDeploymentService(t)
		expectServing(statements, nil)
		statements.EXPECT().CreateDeployment(gomock.Any(), gomock.Any(), gomock.Any()).Return(new(database.UniqueError))
		read := expectServing(statements, servingDeployment("rel_0"))
		expectInsert(statements, read)

		result, err := svc.Create(t.Context(), deploymentInput())
		require.NoError(t, err)
		assert.True(t, result.Created)
	})

	t.Run("guarded deploy answers a conflict without retrying", func(t *testing.T) {
		svc, statements := newMockedDeploymentService(t)
		before := servingDeployment("rel_0")
		before.ID = "dep_before"
		expectServing(statements, before)
		statements.EXPECT().CreateDeployment(gomock.Any(), gomock.Any(), gomock.Any()).Return(new(database.UniqueError))
		winner := servingDeployment("rel_0")
		statements.EXPECT().GetNewestPerOrigin(gomock.Any(), "proj_1", []string{appOrigin}).Return([]domain.OriginDeployment{{
			Origin: appOrigin, DeploymentID: winner.ID, DeployedAt: winner.DeployedAt, Seq: 8,
		}}, nil)
		statements.EXPECT().ListDeployments(unrestricted, gomock.Any()).
			Return(&database.ListResult[*domain.Deployment]{Items: []*domain.Deployment{winner}}, nil)

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
			statements.EXPECT().CreateDeployment(gomock.Any(), gomock.Any(), gomock.Any()).Return(new(database.UniqueError))
		}
		winner := servingDeployment("rel_0")
		statements.EXPECT().GetNewestPerOrigin(gomock.Any(), "proj_1", []string{appOrigin}).Return([]domain.OriginDeployment{{
			Origin: appOrigin, DeploymentID: winner.ID, DeployedAt: winner.DeployedAt, Seq: 9,
		}}, nil)
		statements.EXPECT().ListDeployments(unrestricted, gomock.Any()).
			Return(&database.ListResult[*domain.Deployment]{Items: []*domain.Deployment{winner}}, nil)

		_, err := svc.Create(t.Context(), deploymentInput())
		de := assertServiceDomainCode(t, err, domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{}).Code)
		assert.Equal(t, domain.DeploymentConflictDetails{Deployment: winner}, de.Details)
	})
}

// Deploying the release the newest primary deployment has, to the same
// origins, writes nothing and answers with that deployment.
func TestDeploymentServiceCreateUnchangedPrimaryWritesNothing(t *testing.T) {
	svc, statements := newMockedDeploymentService(t)
	serving := servingDeployment("rel_1")
	expectServing(statements, serving)

	result, err := svc.Create(t.Context(), deploymentInput())
	require.NoError(t, err)
	assert.False(t, result.Created)
	assert.Same(t, serving, result.Deployment)
}

// An origin last served by a preview of the same release still gets the
// primary deploy written, or it would expire with the preview.
func TestDeploymentServiceCreatePrimaryOverPreviewWrites(t *testing.T) {
	svc, statements := newMockedDeploymentService(t)
	serving := servingDeployment("rel_1")
	serving.OriginKind = domain.DeploymentOriginKindPreview
	expectInsert(statements, expectServing(statements, serving))

	result, err := svc.Create(t.Context(), deploymentInput())
	require.NoError(t, err)
	assert.True(t, result.Created)
}

// A preview deploy is always written, and renews the previews from its stamp.
func TestDeploymentServiceCreatePreviewAlwaysRenews(t *testing.T) {
	svc, statements := newMockedDeploymentService(t)
	serving := servingDeployment("rel_1")
	serving.OriginKind = domain.DeploymentOriginKindPreview
	statements.EXPECT().GetReleaseByID(gomock.Any(), "proj_1", "rel_1").Return(&domain.Release{ID: "rel_1"}, nil)
	read := []domain.OriginDeployment{{
		Origin: appOrigin, DeploymentID: serving.ID, ReleaseID: serving.ReleaseID, Kind: serving.OriginKind,
		DeployedAt: serving.DeployedAt, Seq: 7,
	}}
	statements.EXPECT().GetNewestPerOrigin(gomock.Any(), "proj_1", []string{appOrigin}).Return(read, nil)
	statements.EXPECT().GetDeploymentByID(gomock.Any(), "proj_1", serving.ID).Return(serving, nil)
	expectInsert(statements, read)
	statements.EXPECT().UpsertPreviews(gomock.Any(), "proj_1", []string{appOrigin}, deployedAt.Add(168*time.Hour), deployedAt).Return(nil)

	input := deploymentInput()
	input.OriginKind = domain.DeploymentOriginKindPreview
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

func expectProjectOrigins(statements *servicemocks.MockAllStatements, origins ...domain.Origin) {
	statements.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1", Origins: origins}, nil)
}

var appPrimary = domain.Origin{Pattern: appOrigin, Kind: domain.OriginKindPrimary}

func TestDeploymentServiceDeployExpandsPrimary(t *testing.T) {
	svc, statements := newMockedDeploymentService(t)
	expectProjectOrigins(statements, appPrimary)
	expectInsert(statements, expectServing(statements, nil))

	result, err := svc.Deploy(t.Context(), service.DeployInput{ProjectID: "proj_1", ReleaseID: "rel_1", Targets: []string{"primary"}})
	require.NoError(t, err)
	assert.True(t, result.Created)
	assert.Equal(t, []string{appOrigin}, result.Deployment.Origins())
}

func TestDeploymentServiceDeployRejects(t *testing.T) {
	t.Run("a ttl for primary origins", func(t *testing.T) {
		svc, statements := newMockedDeploymentService(t)
		expectProjectOrigins(statements, appPrimary)
		_, err := svc.Deploy(t.Context(), service.DeployInput{ProjectID: "proj_1", ReleaseID: "rel_1", Targets: []string{"primary"}, HasTTL: true})
		assertServiceDomainCode(t, err, domain.ErrDeploymentInvalid().Code)
	})

	t.Run("an exact primary origin", func(t *testing.T) {
		svc, statements := newMockedDeploymentService(t)
		expectProjectOrigins(statements, appPrimary)
		_, err := svc.Deploy(t.Context(), service.DeployInput{ProjectID: "proj_1", ReleaseID: "rel_1", Targets: []string{appOrigin}})
		assertServiceDomainCode(t, err, domain.ErrDeploymentInvalid().Code)
	})

	t.Run("a missing project", func(t *testing.T) {
		svc, statements := newMockedDeploymentService(t)
		statements.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(nil, database.NewNoRowFoundError(nil))
		_, err := svc.Deploy(t.Context(), service.DeployInput{ProjectID: "proj_1", ReleaseID: "rel_1", Targets: []string{"primary"}})
		assertServiceDomainCode(t, err, domain.ErrProjectNotFound().Code)
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
		statements.EXPECT().CreateDeployment(gomock.Any(), gomock.Any(), gomock.Any()).Return(new(database.ForeignKeyError))

		_, err := svc.Create(t.Context(), deploymentInput())
		assertServiceDomainCode(t, err, domain.ErrProjectNotFound().Code)
	})

	t.Run("invalid input never reaches storage", func(t *testing.T) {
		svc, _ := newMockedDeploymentService(t)
		input := deploymentInput()
		input.RollbackTo = new("dep_1")
		_, err := svc.Create(t.Context(), input)
		assertServiceDomainCode(t, err, domain.ErrDeploymentInvalid().Code)
	})

	t.Run("preview without ttl never reaches storage", func(t *testing.T) {
		svc, _ := newMockedDeploymentService(t)
		input := deploymentInput()
		input.OriginKind = domain.DeploymentOriginKindPreview
		_, err := svc.Create(t.Context(), input)
		assertServiceDomainCode(t, err, domain.ErrDeploymentInvalid().Code)
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
	expectStatusLookup(statements, items[0])
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
	only := &domain.Deployment{ProjectID: "proj_1", ID: "dep_1", ReleaseID: "rel_a"}
	statements.EXPECT().
		ListDeployments(gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.Deployment]{Items: []*domain.Deployment{only}}, nil)
	expectStatusLookup(statements, only)

	result, err := svc.List(t.Context(), service.ListDeploymentsInput{ProjectID: "proj_1"})
	require.NoError(t, err)
	assert.Nil(t, result.ReleasesByID)
}

// expectStatusLookup answers the unfiltered read of which listed deployments
// are live, with live.
func expectStatusLookup(statements *servicemocks.MockAllStatements, live ...*domain.Deployment) {
	statements.EXPECT().ListLiveDeployments(unrestricted, gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.Deployment]{Items: live}, nil)
}

// status is what the storage live predicate answers for the listed ids.
func TestDeploymentServiceListStatus(t *testing.T) {
	svc, statements := newMockedDeploymentService(t)
	newer := &domain.Deployment{ProjectID: "proj_1", ID: "dep_newer"}
	preview := &domain.Deployment{ProjectID: "proj_1", ID: "dep_preview", OriginKind: domain.DeploymentOriginKindPreview}
	older := &domain.Deployment{ProjectID: "proj_1", ID: "dep_older"}
	statements.EXPECT().ListDeployments(gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.Deployment]{Items: []*domain.Deployment{newer, preview, older}}, nil)
	expectStatusLookup(statements, newer, preview)

	result, err := svc.List(t.Context(), service.ListDeploymentsInput{ProjectID: "proj_1"})
	require.NoError(t, err)
	assert.Equal(t, map[string]bool{"dep_newer": true, "dep_preview": true}, result.Live)
}

// The live view is one page of the storage live list, with its cursor.
func TestDeploymentServiceListLive(t *testing.T) {
	svc, statements := newMockedDeploymentService(t)
	served := &domain.Deployment{ProjectID: "proj_1", ID: "dep_served"}
	statements.EXPECT().ListLiveDeployments(gomock.Any(), gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, _ time.Time, opts *database.ListOptions[domain.DeploymentField]) (*database.ListResult[*domain.Deployment], error) {
			assert.Equal(t, []byte("cursor"), opts.Pagination.Cursor)
			return &database.ListResult[*domain.Deployment]{Items: []*domain.Deployment{served}, NextCursor: []byte("next")}, nil
		})

	result, err := svc.List(t.Context(), service.ListDeploymentsInput{ProjectID: "proj_1", Live: true, PageToken: "cursor"})
	require.NoError(t, err)
	assert.Equal(t, []*domain.Deployment{served}, result.Items)
	assert.Equal(t, "next", result.NextPageToken)
	assert.True(t, result.Live["dep_served"])
}

// With an origin, the live view keeps the deployment serving it.
func TestDeploymentServiceListLiveOrigin(t *testing.T) {
	svc, statements := newMockedDeploymentService(t)
	serving := &domain.Deployment{ID: "dep_serving", Targets: []domain.DeploymentTarget{{Origin: appOrigin}}}
	elsewhere := &domain.Deployment{ID: "dep_elsewhere", Targets: []domain.DeploymentTarget{{Origin: "https://www.acme.com"}}}
	statements.EXPECT().ListLiveDeployments(gomock.Any(), gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.Deployment]{Items: []*domain.Deployment{elsewhere, serving}, NextCursor: []byte("next")}, nil)

	result, err := svc.List(t.Context(), service.ListDeploymentsInput{ProjectID: "proj_1", Live: true, Origin: new(appOrigin)})
	require.NoError(t, err)
	assert.Equal(t, []*domain.Deployment{serving}, result.Items)
	assert.Empty(t, result.NextPageToken)
}
