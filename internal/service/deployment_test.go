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
	assert.Nil(t, result.PreviewExpiresAt)
}

var acmePreviews = domain.Origin{Pattern: "https://*-acmeinc.vercel.app", Kind: domain.OriginKindPreview}

const previewOrigin = "https://acme-git-sso-acmeinc.vercel.app"

// expectPreviewWrite sets up one preview deploy to previewOrigin, which no
// deployment has reached yet, and the renewal of its preview to expiresAt.
func expectPreviewWrite(statements *servicemocks.MockAllStatements, expiresAt time.Time) {
	expectProjectOrigins(statements, appPrimary, acmePreviews)
	statements.EXPECT().GetReleaseByID(gomock.Any(), "proj_1", "rel_1").Return(&domain.Release{ID: "rel_1"}, nil)
	statements.EXPECT().GetNewestPerOrigin(gomock.Any(), "proj_1", []string{previewOrigin}).Return(nil, nil)
	expectInsert(statements, nil)
	statements.EXPECT().UpsertPreviews(gomock.Any(), "proj_1", []string{previewOrigin}, expiresAt, deployedAt).Return(nil)
}

func TestDeploymentServiceDeployToPreviewURLs(t *testing.T) {
	t.Run("renews the previews for the ttl", func(t *testing.T) {
		svc, statements := newMockedDeploymentService(t)
		expectPreviewWrite(statements, deployedAt.Add(time.Hour))

		result, err := svc.Deploy(t.Context(), service.DeployInput{ProjectID: "proj_1", ReleaseID: "rel_1", Targets: []string{previewOrigin}, TTL: new(time.Hour)})
		require.NoError(t, err)
		assert.True(t, result.Created)
		assert.Equal(t, domain.DeploymentOriginKindPreview, result.Deployment.OriginKind)
		assert.Equal(t, []string{previewOrigin}, result.Deployment.Origins())
		require.NotNil(t, result.PreviewExpiresAt)
		assert.Equal(t, deployedAt.Add(time.Hour), *result.PreviewExpiresAt)
	})

	t.Run("without a ttl takes the default", func(t *testing.T) {
		svc, statements := newMockedDeploymentService(t)
		expectPreviewWrite(statements, deployedAt.Add(domain.DefaultPreviewTTL))

		result, err := svc.Deploy(t.Context(), service.DeployInput{ProjectID: "proj_1", ReleaseID: "rel_1", Targets: []string{previewOrigin}})
		require.NoError(t, err)
		assert.Equal(t, deployedAt.Add(domain.DefaultPreviewTTL), *result.PreviewExpiresAt)
	})
}

func TestDeploymentServiceDeployRejects(t *testing.T) {
	t.Run("a ttl for primary origins", func(t *testing.T) {
		svc, statements := newMockedDeploymentService(t)
		expectProjectOrigins(statements, appPrimary)
		_, err := svc.Deploy(t.Context(), service.DeployInput{ProjectID: "proj_1", ReleaseID: "rel_1", Targets: []string{"primary"}, TTL: new(time.Hour)})
		assertServiceDomainCode(t, err, domain.ErrDeploymentInvalid().Code)
	})

	t.Run("a URL no preview pattern admits", func(t *testing.T) {
		svc, statements := newMockedDeploymentService(t)
		expectProjectOrigins(statements, appPrimary, acmePreviews)
		_, err := svc.Deploy(t.Context(), service.DeployInput{ProjectID: "proj_1", ReleaseID: "rel_1", Targets: []string{"https://acme.example"}})
		de := assertServiceDomainCode(t, err, domain.ErrProjectOriginNotAllowed("").Code)
		assert.Equal(t, map[string]string{"origin": "https://acme.example"}, de.Details)
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

// expectNewestPrimary answers the read of the project's newest primary
// deployment, after any other list read the test set up.
func expectNewestPrimary(statements *servicemocks.MockAllStatements, newest *domain.Deployment) {
	result := &database.ListResult[*domain.Deployment]{}
	if newest != nil {
		result.Items = []*domain.Deployment{newest}
	}
	statements.EXPECT().ListDeployments(unrestricted, gomock.Any()).Return(result, nil)
}

// expectStatusLookup answers the reads behind a primary deployment's status:
// the project, whose only origin is appOrigin, and its newest primary
// deployment.
func expectStatusLookup(statements *servicemocks.MockAllStatements, newest *domain.Deployment) {
	expectProjectOrigins(statements, appPrimary)
	expectNewestPrimary(statements, newest)
}

// A primary deployment is live while it is the newest primary one; a
// preview one while one of its URLs still serves it.
func TestDeploymentServiceListStatus(t *testing.T) {
	svc, statements := newMockedDeploymentService(t)
	newer := &domain.Deployment{
		ProjectID: "proj_1", ID: "dep_newer", OriginKind: domain.DeploymentOriginKindPrimary,
		Targets: []domain.DeploymentTarget{{Origin: appOrigin}},
	}
	preview := &domain.Deployment{ProjectID: "proj_1", ID: "dep_preview", OriginKind: domain.DeploymentOriginKindPreview}
	expired := &domain.Deployment{ProjectID: "proj_1", ID: "dep_expired", OriginKind: domain.DeploymentOriginKindPreview}
	older := &domain.Deployment{ProjectID: "proj_1", ID: "dep_older", OriginKind: domain.DeploymentOriginKindPrimary}
	statements.EXPECT().ListDeployments(gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.Deployment]{Items: []*domain.Deployment{newer, preview, expired, older}}, nil)
	expectStatusLookup(statements, newer)
	statements.EXPECT().ListLiveDeployments(unrestricted, gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.Deployment]{Items: []*domain.Deployment{preview}}, nil)

	result, err := svc.List(t.Context(), service.ListDeploymentsInput{ProjectID: "proj_1"})
	require.NoError(t, err)
	assert.Equal(t, map[string]bool{"dep_newer": true, "dep_preview": true}, result.Live)
}

// The live view leads with the newest primary deployment, narrowed to the
// origins that are still primary, then the live previews newest first.
func TestDeploymentServiceListLive(t *testing.T) {
	svc, statements := newMockedDeploymentService(t)
	statements.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1", Origins: []domain.Origin{
		{Pattern: appOrigin, Kind: domain.OriginKindPrimary},
	}}, nil)
	primary := &domain.Deployment{
		ProjectID: "proj_1", ID: "dep_primary", OriginKind: domain.DeploymentOriginKindPrimary, DeployedAt: deployedAt,
		Targets: []domain.DeploymentTarget{{Origin: appOrigin}, {Origin: "https://removed.acme.com"}},
	}
	expectNewestPrimary(statements, primary)
	newerPreview := &domain.Deployment{ID: "dep_newer", OriginKind: domain.DeploymentOriginKindPreview, DeployedAt: deployedAt.Add(time.Hour)}
	olderPreview := &domain.Deployment{ID: "dep_older", OriginKind: domain.DeploymentOriginKindPreview, DeployedAt: deployedAt.Add(-time.Hour)}
	statements.EXPECT().ListLiveDeployments(gomock.Any(), gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.Deployment]{Items: []*domain.Deployment{newerPreview, olderPreview}}, nil)

	result, err := svc.List(t.Context(), service.ListDeploymentsInput{ProjectID: "proj_1", Live: true})
	require.NoError(t, err)
	require.Len(t, result.Items, 3)
	assert.Equal(t, []string{"dep_primary", "dep_newer", "dep_older"},
		[]string{result.Items[0].ID, result.Items[1].ID, result.Items[2].ID})
	assert.Equal(t, []string{appOrigin}, result.Items[0].Origins())
	assert.Len(t, primary.Targets, 2, "the stored deployment is not narrowed")
	assert.True(t, result.Live["dep_primary"])
}

// With origin, a primary origin the newest primary deployment does not cover
// serves nothing.
func TestDeploymentServiceListLiveOriginNotCovered(t *testing.T) {
	svc, statements := newMockedDeploymentService(t)
	statements.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1", Origins: []domain.Origin{
		{Pattern: appOrigin, Kind: domain.OriginKindPrimary},
		{Pattern: "https://www.acme.com", Kind: domain.OriginKindPrimary},
	}}, nil)
	expectNewestPrimary(statements, &domain.Deployment{
		ProjectID: "proj_1", ID: "dep_primary", OriginKind: domain.DeploymentOriginKindPrimary,
		Targets: []domain.DeploymentTarget{{Origin: appOrigin}},
	})

	result, err := svc.List(t.Context(), service.ListDeploymentsInput{ProjectID: "proj_1", Live: true, Origin: new("https://www.acme.com")})
	require.NoError(t, err)
	assert.Empty(t, result.Items)
}

// With a limit of one, the first live page is the primary deployment, and it
// hands out a token only when a live preview follows; the token resumes the
// previews from the start.
func TestDeploymentServiceListLivePagesPastThePrimary(t *testing.T) {
	primary := &domain.Deployment{
		ProjectID: "proj_1", ID: "dep_primary", OriginKind: domain.DeploymentOriginKindPrimary,
		Targets: []domain.DeploymentTarget{{Origin: appOrigin}},
	}
	preview := &domain.Deployment{ID: "dep_preview", OriginKind: domain.DeploymentOriginKindPreview}
	livePreviews := func(statements *servicemocks.MockAllStatements, items ...*domain.Deployment) {
		statements.EXPECT().ListLiveDeployments(gomock.Any(), gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, _ time.Time, opts *database.ListOptions[domain.DeploymentField]) (*database.ListResult[*domain.Deployment], error) {
				assert.Empty(t, opts.Pagination.Cursor)
				return &database.ListResult[*domain.Deployment]{Items: items}, nil
			})
	}

	t.Run("a preview follows", func(t *testing.T) {
		svc, statements := newMockedDeploymentService(t)
		expectProjectOrigins(statements, appPrimary)
		expectNewestPrimary(statements, primary)
		livePreviews(statements, preview)

		first, err := svc.List(t.Context(), service.ListDeploymentsInput{ProjectID: "proj_1", Live: true, Limit: 1})
		require.NoError(t, err)
		assert.Equal(t, []*domain.Deployment{primary}, first.Items)
		require.NotEmpty(t, first.NextPageToken)

		expectProjectOrigins(statements, appPrimary)
		livePreviews(statements, preview)
		second, err := svc.List(t.Context(), service.ListDeploymentsInput{ProjectID: "proj_1", Live: true, Limit: 1, PageToken: first.NextPageToken})
		require.NoError(t, err)
		assert.Equal(t, []*domain.Deployment{preview}, second.Items)
		assert.Empty(t, second.NextPageToken)
	})

	t.Run("nothing follows", func(t *testing.T) {
		svc, statements := newMockedDeploymentService(t)
		expectProjectOrigins(statements, appPrimary)
		expectNewestPrimary(statements, primary)
		livePreviews(statements)

		first, err := svc.List(t.Context(), service.ListDeploymentsInput{ProjectID: "proj_1", Live: true, Limit: 1})
		require.NoError(t, err)
		assert.Equal(t, []*domain.Deployment{primary}, first.Items)
		assert.Empty(t, first.NextPageToken)
	})
}

// A caller whose list filter does not admit the newest primary deployment
// does not see it in the live view.
func TestDeploymentServiceListLiveHonoursTheListFilter(t *testing.T) {
	svc, statements := newMockedDeploymentService(t)
	expectProjectOrigins(statements, appPrimary)
	expectNewestPrimary(statements, &domain.Deployment{
		ProjectID: "proj_1", ID: "dep_primary", OriginKind: domain.DeploymentOriginKindPrimary,
		Targets: []domain.DeploymentTarget{{Origin: appOrigin}},
	})
	filtered := gomock.Cond(func(ctx context.Context) bool {
		_, ok := service.AuthzListFilterFromContext(ctx)
		return ok
	})
	statements.EXPECT().ListDeployments(filtered, gomock.Any()).Return(&database.ListResult[*domain.Deployment]{}, nil)
	statements.EXPECT().ListLiveDeployments(filtered, gomock.Any(), gomock.Any()).Return(&database.ListResult[*domain.Deployment]{}, nil)

	ctx := service.WithAuthzListFilter(t.Context(), service.AuthzListFilter{})
	result, err := svc.List(ctx, service.ListDeploymentsInput{ProjectID: "proj_1", Live: true})
	require.NoError(t, err)
	assert.Empty(t, result.Items)
}
