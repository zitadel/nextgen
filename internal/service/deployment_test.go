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

type deploymentMocks struct {
	statements *servicemocks.MockAllStatements
	releases   *servicemocks.MockReleaseService
	vars       *servicemocks.MockVariableService
}

func newMockedDeploymentService(t *testing.T) (*service.DeploymentService, deploymentMocks) {
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
	mocks := deploymentMocks{
		statements: statements,
		releases:   servicemocks.NewMockReleaseService(ctrl),
		vars:       servicemocks.NewMockVariableService(ctrl),
	}
	return service.NewDeploymentService(service.NewPool(pool), mocks.releases, mocks.vars), mocks
}

var deploymentProject = &domain.Project{
	ID:   "proj_1",
	Mode: domain.ProjectModeSandbox,
	Origins: []domain.Origin{
		{Pattern: "https://app.acme.com", Kind: domain.OriginKindPrimary},
		{Pattern: "https://www.acme.com", Kind: domain.OriginKindPrimary},
		{Pattern: "https://*-acme.vercel.app", Kind: domain.OriginKindPreview},
	},
}

var deploymentRelease = &domain.Release{ProjectID: "proj_1", ID: "rel_1", ContentHash: "9f2c"}

func deploymentOf(id, releaseID string, origins ...string) *domain.Deployment {
	targets := make([]domain.DeploymentTarget, len(origins))
	for i, origin := range origins {
		targets[i] = domain.DeploymentTarget{Origin: origin}
	}
	return &domain.Deployment{ProjectID: "proj_1", ID: id, ReleaseID: releaseID, Targets: targets}
}

// expectWrite wires the happy write path: no target serves anything yet, the
// project row is locked and the deployment is inserted with its targets.
func (m deploymentMocks) expectWrite(t *testing.T, id string, targets int) **domain.Deployment {
	t.Helper()
	m.statements.EXPECT().NewestDeployment(gomock.Any(), "proj_1", gomock.Any()).
		Return(nil, database.NewNoRowFoundError(nil)).AnyTimes()
	m.statements.EXPECT().LockProject(gomock.Any(), "proj_1").Return(nil)
	var written *domain.Deployment
	m.statements.EXPECT().CreateDeployment(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, entity *domain.Deployment) error {
			require.Len(t, entity.Targets, targets)
			entity.ID = id
			entity.DeployedAt = time.Now()
			written = entity
			return nil
		})
	return &written
}

func deployInput(targets ...string) service.CreateDeploymentInput {
	return service.CreateDeploymentInput{
		ProjectID:  "proj_1",
		ReleaseRef: "rel_1",
		Targets:    targets,
		Reason:     domain.DeploymentReasonDeploy,
	}
}

func TestDeploymentServiceCreateFansOutOverPrimaries(t *testing.T) {
	svc, m := newMockedDeploymentService(t)
	m.releases.EXPECT().GetByRef(gomock.Any(), "proj_1", "rel_1").Return(deploymentRelease, nil)
	m.statements.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(deploymentProject, nil)
	m.vars.EXPECT().ResolveForDeploy(gomock.Any(), "proj_1", false).Return(nil, nil, nil)
	written := m.expectWrite(t, "dep_1", 3)

	ctx := audit.WithActorContext(t.Context(), audit.ActorContext{
		ActorID:   new("user_1"),
		ActorType: new(domain.EventActorTypeHuman),
	})
	result, err := svc.Create(ctx, deployInput(service.TargetDefault, service.TargetPrimary))
	require.NoError(t, err)
	assert.True(t, result.Created)
	assert.Equal(t, "dep_1", result.Deployment.ID)
	assert.Equal(t, []string{"", "https://app.acme.com", "https://www.acme.com"}, result.Deployment.Origins())
	require.NotNil(t, *written)
	assert.Equal(t, "user_1", *(*written).Metadata.DeployedBy)
}

func TestDeploymentServiceCreatePreviewWritesPreviews(t *testing.T) {
	svc, m := newMockedDeploymentService(t)
	m.releases.EXPECT().GetByRef(gomock.Any(), "proj_1", "rel_1").Return(deploymentRelease, nil)
	m.statements.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(deploymentProject, nil)
	secret, err := domain.NewVariable("CLIENT_ID", domain.VariableOwner{ProjectID: "proj_1"}, domain.VariableAppliesToPreview, "preview")
	require.NoError(t, err)
	m.vars.EXPECT().ResolveForDeploy(gomock.Any(), "proj_1", true).Return([]*domain.Variable{secret}, []string{"warned"}, nil)
	m.expectWrite(t, "dep_1", 1)
	m.statements.EXPECT().CreateDeploymentVariables(gomock.Any(), gomock.Len(1)).Return(nil)
	m.statements.EXPECT().UpsertPreview(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, row *domain.Preview) error {
		assert.Equal(t, "https://pr-1-acme.vercel.app", row.Origin)
		assert.WithinDuration(t, time.Now().Add(time.Hour), row.ExpiresAt, time.Minute)
		return nil
	})

	ttl := time.Hour
	input := deployInput("https://PR-1-acme.vercel.app")
	input.TTL = &ttl
	input.PreviewOnly = true
	result, err := svc.Create(t.Context(), input)
	require.NoError(t, err)
	assert.Equal(t, []string{"warned"}, result.Warnings)
}

func TestDeploymentServiceCreateRefusals(t *testing.T) {
	setup := func(t *testing.T) (*service.DeploymentService, deploymentMocks) {
		svc, m := newMockedDeploymentService(t)
		m.releases.EXPECT().GetByRef(gomock.Any(), "proj_1", "rel_1").Return(deploymentRelease, nil).AnyTimes()
		m.statements.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(deploymentProject, nil).AnyTimes()
		return svc, m
	}

	t.Run("an origin no pattern covers", func(t *testing.T) {
		svc, _ := setup(t)
		_, err := svc.Create(t.Context(), deployInput("https://evil.example"))
		assertServiceDomainCode(t, err, domain.ErrProjectOriginNotAllowed(nil).Code)
	})

	t.Run("a preview target mixed with the default", func(t *testing.T) {
		svc, _ := setup(t)
		ttl := time.Hour
		input := deployInput(service.TargetDefault, "https://pr-1-acme.vercel.app")
		input.TTL = &ttl
		_, err := svc.Create(t.Context(), input)
		assertServiceDomainCode(t, err, domain.ErrDeploymentInvalid(nil, nil).Code)
	})

	t.Run("a preview target without a ttl", func(t *testing.T) {
		svc, _ := setup(t)
		_, err := svc.Create(t.Context(), deployInput("https://pr-1-acme.vercel.app"))
		assertServiceDomainCode(t, err, domain.ErrDeploymentInvalid(nil, nil).Code)
	})

	t.Run("the preview credential may not move production", func(t *testing.T) {
		svc, _ := setup(t)
		input := deployInput(service.TargetDefault)
		input.PreviewOnly = true
		_, err := svc.Create(t.Context(), input)
		assertServiceDomainCode(t, err, domain.ErrDeploymentPermissionDenied().Code)
	})

	t.Run("a revoked release", func(t *testing.T) {
		svc, m := newMockedDeploymentService(t)
		at := time.Now()
		m.releases.EXPECT().GetByRef(gomock.Any(), "proj_1", "rel_1").
			Return(&domain.Release{ID: "rel_1", RevokedAt: &at}, nil)
		_, err := svc.Create(t.Context(), deployInput(service.TargetDefault))
		assertServiceDomainCode(t, err, domain.ErrReleaseRevoked().Code)
	})
}

// Deploying what every target already serves, with the same frozen values,
// writes nothing and reports Created false.
func TestDeploymentServiceCreateIsIdempotent(t *testing.T) {
	svc, m := newMockedDeploymentService(t)
	m.releases.EXPECT().GetByRef(gomock.Any(), "proj_1", "rel_1").Return(deploymentRelease, nil)
	m.statements.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(deploymentProject, nil)
	value, err := domain.NewVariable("HOST", domain.VariableOwner{ProjectID: "proj_1"}, domain.VariableAppliesToAll, "acme.com")
	require.NoError(t, err)
	m.vars.EXPECT().ResolveForDeploy(gomock.Any(), "proj_1", false).Return([]*domain.Variable{value}, nil, nil)
	existing := deploymentOf("dep_old", "rel_1", "")
	m.statements.EXPECT().NewestDeployment(gomock.Any(), "proj_1", "").Return(existing, nil)
	m.statements.EXPECT().GetDeploymentVariables(gomock.Any(), "proj_1", "dep_old").
		Return([]*domain.DeploymentVariable{{Name: "HOST", Value: "acme.com"}}, nil)

	result, err := svc.Create(t.Context(), deployInput(service.TargetDefault))
	require.NoError(t, err)
	assert.False(t, result.Created)
	assert.Equal(t, "dep_old", result.Deployment.ID)
}

// Targets served by two different deployments of the same release are not
// "already serving": the answer must be one deployment, so a new one is
// written over the set.
func TestDeploymentServiceCreateUnifiesSplitTargets(t *testing.T) {
	svc, m := newMockedDeploymentService(t)
	m.releases.EXPECT().GetByRef(gomock.Any(), "proj_1", "rel_1").Return(deploymentRelease, nil)
	m.statements.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(deploymentProject, nil)
	m.vars.EXPECT().ResolveForDeploy(gomock.Any(), "proj_1", false).Return(nil, nil, nil)
	m.statements.EXPECT().NewestDeployment(gomock.Any(), "proj_1", "").Return(deploymentOf("dep_a", "rel_1", ""), nil).Times(2)
	m.statements.EXPECT().NewestDeployment(gomock.Any(), "proj_1", "https://app.acme.com").Return(deploymentOf("dep_b", "rel_1", "https://app.acme.com"), nil)
	m.statements.EXPECT().LockProject(gomock.Any(), "proj_1").Return(nil)
	m.statements.EXPECT().CreateDeployment(gomock.Any(), gomock.Any()).Return(nil)

	expected := "dep_a"
	input := deployInput(service.TargetDefault, "https://app.acme.com")
	input.ExpectedDeploymentID = &expected
	result, err := svc.Create(t.Context(), input)
	require.NoError(t, err)
	assert.True(t, result.Created)
}

// The same release with a changed value is a new deployment: the frozen set
// is part of the idempotency key.
func TestDeploymentServiceCreateVariableOnlyRedeploy(t *testing.T) {
	svc, m := newMockedDeploymentService(t)
	m.releases.EXPECT().GetByRef(gomock.Any(), "proj_1", "rel_1").Return(deploymentRelease, nil)
	m.statements.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(deploymentProject, nil)
	value, err := domain.NewVariable("HOST", domain.VariableOwner{ProjectID: "proj_1"}, domain.VariableAppliesToAll, "new.acme.com")
	require.NoError(t, err)
	m.vars.EXPECT().ResolveForDeploy(gomock.Any(), "proj_1", false).Return([]*domain.Variable{value}, nil, nil)
	existing := deploymentOf("dep_old", "rel_1", "")
	m.statements.EXPECT().NewestDeployment(gomock.Any(), "proj_1", "").Return(existing, nil)
	m.statements.EXPECT().GetDeploymentVariables(gomock.Any(), "proj_1", "dep_old").
		Return([]*domain.DeploymentVariable{{Name: "HOST", Value: "acme.com"}}, nil)
	m.statements.EXPECT().LockProject(gomock.Any(), "proj_1").Return(nil)
	m.statements.EXPECT().CreateDeployment(gomock.Any(), gomock.Any()).Return(nil)
	m.statements.EXPECT().CreateDeploymentVariables(gomock.Any(), gomock.Len(1)).Return(nil)

	result, err := svc.Create(t.Context(), deployInput(service.TargetDefault))
	require.NoError(t, err)
	assert.True(t, result.Created)
}

func TestDeploymentServiceCreateExpectedDeploymentConflict(t *testing.T) {
	svc, m := newMockedDeploymentService(t)
	m.releases.EXPECT().GetByRef(gomock.Any(), "proj_1", "rel_1").Return(deploymentRelease, nil)
	m.statements.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(deploymentProject, nil)
	m.vars.EXPECT().ResolveForDeploy(gomock.Any(), "proj_1", false).Return(nil, nil, nil)
	actual := deploymentOf("dep_actual", "rel_other", "")
	m.statements.EXPECT().NewestDeployment(gomock.Any(), "proj_1", "").Return(actual, nil).Times(2)
	m.statements.EXPECT().LockProject(gomock.Any(), "proj_1").Return(nil)

	expected := "dep_stale"
	input := deployInput(service.TargetDefault)
	input.ExpectedDeploymentID = &expected
	_, err := svc.Create(t.Context(), input)
	assertServiceDomainCode(t, err, domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{}).Code)
	de := err.(domain.Error)
	assert.Equal(t, domain.DeploymentConflictDetails{CurrentDeploymentID: "dep_actual", CurrentReleaseID: "rel_other"}, de.Details)
}

func assertServiceDomainCode(t *testing.T, err error, code string) {
	t.Helper()
	require.Error(t, err)
	de, ok := err.(domain.Error)
	require.True(t, ok, "expected a domain error, got %T", err)
	assert.Equal(t, code, de.Code)
}

// Undoing the newest deployment restores, per target, the release that
// target served before it, carrying that deployment's frozen values rather
// than the store's.
func TestDeploymentServiceRollbackRestoresPreviousRelease(t *testing.T) {
	svc, m := newMockedDeploymentService(t)
	newest := deploymentOf("dep_c", "rel_2", "", "https://app.acme.com")
	earlier := deploymentOf("dep_a", "rel_1", "")
	// In the order the service asks: the newest deployment, then each
	// target's history.
	gomock.InOrder(
		m.statements.EXPECT().ListDeployments(gomock.Any(), gomock.Any()).
			Return(&database.ListResult[*domain.Deployment]{Items: []*domain.Deployment{newest}}, nil),
		m.statements.EXPECT().ListDeployments(gomock.Any(), gomock.Any()).
			Return(&database.ListResult[*domain.Deployment]{Items: []*domain.Deployment{newest, earlier}}, nil),
		m.statements.EXPECT().ListDeployments(gomock.Any(), gomock.Any()).
			Return(&database.ListResult[*domain.Deployment]{Items: []*domain.Deployment{newest}}, nil),
	)
	m.statements.EXPECT().NewestDeployment(gomock.Any(), "proj_1", "").Return(newest, nil)
	m.releases.EXPECT().Get(gomock.Any(), "proj_1", "rel_1").Return(&domain.Release{ID: "rel_1"}, nil)
	m.statements.EXPECT().GetDeploymentVariables(gomock.Any(), "proj_1", "dep_a").
		Return([]*domain.DeploymentVariable{{ProjectID: "proj_1", DeploymentID: "dep_a", Name: "HOST", Value: "old"}}, nil)
	m.statements.EXPECT().LockProject(gomock.Any(), "proj_1").Return(nil)
	m.statements.EXPECT().CreateDeployment(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, entity *domain.Deployment) error {
			entity.ID = "dep_e"
			assert.Equal(t, "rel_1", entity.ReleaseID)
			assert.Equal(t, []string{""}, entity.Origins())
			assert.Equal(t, domain.DeploymentReasonRollback, entity.Metadata.Reason)
			assert.Equal(t, "dep_c", *entity.Metadata.RollbackOf)
			return nil
		})
	m.statements.EXPECT().CreateDeploymentVariables(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, rows []*domain.DeploymentVariable) error {
			require.Len(t, rows, 1)
			assert.Equal(t, "dep_e", rows[0].DeploymentID)
			assert.Equal(t, "old", rows[0].Value)
			return nil
		})

	result, err := svc.Rollback(t.Context(), service.RollbackInput{ProjectID: "proj_1"})
	require.NoError(t, err)
	assert.True(t, result.Created)
	assert.Equal(t, "dep_e", result.Deployment.ID)
	require.Len(t, result.Warnings, 1)
	assert.Contains(t, result.Warnings[0], "https://app.acme.com: no earlier release")
}

// A rollback that restores nothing is refused with one note per target in
// the details, so the caller sees why rather than an empty answer.
func TestDeploymentServiceRollbackNothingToUndo(t *testing.T) {
	svc, m := newMockedDeploymentService(t)
	only := deploymentOf("dep_a", "rel_1", "", "https://app.acme.com")
	m.statements.EXPECT().ListDeployments(gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.Deployment]{Items: []*domain.Deployment{only}}, nil).Times(3)

	_, err := svc.Rollback(t.Context(), service.RollbackInput{ProjectID: "proj_1"})
	assertServiceDomainCode(t, err, domain.ErrDeploymentInvalid(nil, nil).Code)
	de := err.(domain.Error)
	assert.Equal(t, service.RollbackNothingToUndo, de.Message)
	warnings := de.Details.(map[string]any)["warnings"].([]string)
	require.Len(t, warnings, 2)
	assert.Contains(t, warnings[0], "(default): no earlier release")
	assert.Contains(t, warnings[1], "https://app.acme.com: no earlier release")
}

// Expanding hydrates the page's releases in one batched, deduplicated read —
// a history is many deployments of few releases.
func TestDeploymentServiceListExpandsReleases(t *testing.T) {
	svc, m := newMockedDeploymentService(t)

	items := []*domain.Deployment{
		deploymentOf("dep_1", "rel_a", ""),
		deploymentOf("dep_2", "rel_b", ""),
		deploymentOf("dep_3", "rel_a", ""),
	}
	m.statements.EXPECT().
		ListDeployments(gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.Deployment]{Items: items}, nil)
	m.statements.EXPECT().
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

// The live view is what every target serves with the preview expiry joined
// in, and nothing else.
func TestDeploymentServiceListLive(t *testing.T) {
	svc, m := newMockedDeploymentService(t)
	m.statements.EXPECT().ListLiveDeployments(gomock.Any(), "proj_1").Return([]*domain.Deployment{
		deploymentOf("dep_2", "rel_b", "https://pr-1-acme.vercel.app"),
		deploymentOf("dep_1", "rel_a", ""),
	}, nil)
	expires := time.Now().Add(time.Hour)
	m.statements.EXPECT().ListPreviews(gomock.Any(), "proj_1").Return([]*domain.Preview{
		{ProjectID: "proj_1", Origin: "https://pr-1-acme.vercel.app", ExpiresAt: expires},
	}, nil)

	result, err := svc.List(t.Context(), service.ListDeploymentsInput{ProjectID: "proj_1", Live: true})
	require.NoError(t, err)
	require.Len(t, result.Items, 2)
	assert.Nil(t, result.ReleasesByID)
	require.NotNil(t, result.Items[0].Targets[0].ExpiresAt)
	assert.Equal(t, expires, *result.Items[0].Targets[0].ExpiresAt)
	assert.Nil(t, result.Items[1].Targets[0].ExpiresAt)
}
