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
	ID:    "proj_1",
	Class: domain.ProjectClassSandbox,
	AllowedOrigins: []domain.AllowedOrigin{
		{Pattern: "https://app.acme.com", Kind: domain.OriginKindPrimary},
		{Pattern: "https://www.acme.com", Kind: domain.OriginKindPrimary},
		{Pattern: "https://*-acme.vercel.app", Kind: domain.OriginKindPreview},
	},
}

var deploymentRelease = &domain.Release{ProjectID: "proj_1", ID: "rel_1", ContentHash: "9f2c"}

// expectWrite wires the happy write path: no row serves anything yet, the
// project row is locked, a deploy id is minted and every row is inserted.
func (m deploymentMocks) expectWrite(t *testing.T, targets int) *[]*domain.Deployment {
	t.Helper()
	m.statements.EXPECT().NewestDeployment(gomock.Any(), "proj_1", gomock.Any()).
		Return(nil, database.NewNoRowFoundError(nil)).AnyTimes()
	m.statements.EXPECT().LockProject(gomock.Any(), "proj_1").Return(nil)
	m.statements.EXPECT().NewManagedID(string(domain.PrefixDeploy)).Return("dpl_1", nil)
	var written []*domain.Deployment
	m.statements.EXPECT().CreateDeployments(gomock.Any(), gomock.Len(targets)).
		DoAndReturn(func(_ context.Context, rows []*domain.Deployment) error {
			for i, row := range rows {
				row.ID = "dep_" + string(rune('a'+i))
				row.DeployedAt = time.Now()
			}
			written = rows
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
	written := m.expectWrite(t, 3)

	ctx := audit.WithActorContext(t.Context(), audit.ActorContext{
		ActorID:   new("user_1"),
		ActorType: new(domain.EventActorTypeHuman),
	})
	result, err := svc.Create(ctx, deployInput(service.TargetDefault, service.TargetPrimary))
	require.NoError(t, err)
	assert.True(t, result.Created)
	assert.Equal(t, "dpl_1", result.DeployID)
	assert.Equal(t, []string{"", "https://app.acme.com", "https://www.acme.com"}, result.Targets)
	require.Len(t, *written, 3)
	for _, row := range *written {
		assert.Equal(t, "dpl_1", row.DeployID)
		assert.Equal(t, "user_1", *row.Metadata.DeployedBy)
	}
}

func TestDeploymentServiceCreatePreviewWritesOriginRows(t *testing.T) {
	svc, m := newMockedDeploymentService(t)
	m.releases.EXPECT().GetByRef(gomock.Any(), "proj_1", "rel_1").Return(deploymentRelease, nil)
	m.statements.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(deploymentProject, nil)
	secret, err := domain.NewVariable("CLIENT_ID", domain.VariableOwner{ProjectID: "proj_1"}, domain.VariableAppliesToPreview, "preview")
	require.NoError(t, err)
	m.vars.EXPECT().ResolveForDeploy(gomock.Any(), "proj_1", true).Return([]*domain.Variable{secret}, []string{"warned"}, nil)
	m.expectWrite(t, 1)
	m.statements.EXPECT().CreateDeploymentVariables(gomock.Any(), gomock.Len(1)).Return(nil)
	m.statements.EXPECT().UpsertOrigin(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, row *domain.Origin) error {
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

	t.Run("an origin the allowlist does not cover", func(t *testing.T) {
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
	existing := &domain.Deployment{ProjectID: "proj_1", ID: "dep_old", DeployID: "dpl_old", ReleaseID: "rel_1"}
	m.statements.EXPECT().NewestDeployment(gomock.Any(), "proj_1", "").Return(existing, nil)
	m.statements.EXPECT().GetDeploymentVariables(gomock.Any(), "proj_1", "dep_old").
		Return([]*domain.DeploymentVariable{{Name: "HOST", Value: "acme.com"}}, nil)

	result, err := svc.Create(t.Context(), deployInput(service.TargetDefault))
	require.NoError(t, err)
	assert.False(t, result.Created)
	assert.Equal(t, "dpl_old", result.DeployID)
}

// The same release with a changed value is a new deploy: the frozen set is
// part of the idempotency key.
func TestDeploymentServiceCreateVariableOnlyRedeploy(t *testing.T) {
	svc, m := newMockedDeploymentService(t)
	m.releases.EXPECT().GetByRef(gomock.Any(), "proj_1", "rel_1").Return(deploymentRelease, nil)
	m.statements.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(deploymentProject, nil)
	value, err := domain.NewVariable("HOST", domain.VariableOwner{ProjectID: "proj_1"}, domain.VariableAppliesToAll, "new.acme.com")
	require.NoError(t, err)
	m.vars.EXPECT().ResolveForDeploy(gomock.Any(), "proj_1", false).Return([]*domain.Variable{value}, nil, nil)
	existing := &domain.Deployment{ProjectID: "proj_1", ID: "dep_old", DeployID: "dpl_old", ReleaseID: "rel_1"}
	m.statements.EXPECT().NewestDeployment(gomock.Any(), "proj_1", "").Return(existing, nil)
	m.statements.EXPECT().GetDeploymentVariables(gomock.Any(), "proj_1", "dep_old").
		Return([]*domain.DeploymentVariable{{Name: "HOST", Value: "acme.com"}}, nil)
	m.statements.EXPECT().LockProject(gomock.Any(), "proj_1").Return(nil)
	m.statements.EXPECT().NewManagedID(string(domain.PrefixDeploy)).Return("dpl_2", nil)
	m.statements.EXPECT().CreateDeployments(gomock.Any(), gomock.Len(1)).Return(nil)
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
	actual := &domain.Deployment{ProjectID: "proj_1", ID: "dep_actual", ReleaseID: "rel_other"}
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

// Undoing the newest deploy restores, per target, the release that target
// served before it, carrying that deployment's frozen values rather than the
// store's.
func TestDeploymentServiceRollbackRestoresPreviousRelease(t *testing.T) {
	svc, m := newMockedDeploymentService(t)
	newest := []*domain.Deployment{
		{ProjectID: "proj_1", ID: "dep_c", DeployID: "dpl_2", Origin: "", ReleaseID: "rel_2"},
		{ProjectID: "proj_1", ID: "dep_d", DeployID: "dpl_2", Origin: "https://app.acme.com", ReleaseID: "rel_2"},
	}
	history := map[string][]*domain.Deployment{
		"":                     {newest[0], {ProjectID: "proj_1", ID: "dep_a", DeployID: "dpl_1", Origin: "", ReleaseID: "rel_1"}},
		"https://app.acme.com": {newest[1]},
	}
	// In the order the service asks: the newest row, the undone deploy's
	// rows, then each target's history.
	gomock.InOrder(
		m.statements.EXPECT().ListDeployments(gomock.Any(), gomock.Any()).
			Return(&database.ListResult[*domain.Deployment]{Items: newest[:1]}, nil),
		m.statements.EXPECT().ListDeployments(gomock.Any(), gomock.Any()).
			Return(&database.ListResult[*domain.Deployment]{Items: newest}, nil),
		m.statements.EXPECT().ListDeployments(gomock.Any(), gomock.Any()).
			Return(&database.ListResult[*domain.Deployment]{Items: history[""]}, nil),
		m.statements.EXPECT().ListDeployments(gomock.Any(), gomock.Any()).
			Return(&database.ListResult[*domain.Deployment]{Items: history["https://app.acme.com"]}, nil),
	)
	m.statements.EXPECT().NewestDeployment(gomock.Any(), "proj_1", "").Return(newest[0], nil)
	m.releases.EXPECT().Get(gomock.Any(), "proj_1", "rel_1").Return(&domain.Release{ID: "rel_1"}, nil)
	m.statements.EXPECT().GetDeploymentVariables(gomock.Any(), "proj_1", "dep_a").
		Return([]*domain.DeploymentVariable{{ProjectID: "proj_1", DeploymentID: "dep_a", Name: "HOST", Value: "old"}}, nil)
	m.statements.EXPECT().LockProject(gomock.Any(), "proj_1").Return(nil)
	m.statements.EXPECT().NewManagedID(string(domain.PrefixDeploy)).Return("dpl_3", nil)
	m.statements.EXPECT().CreateDeployments(gomock.Any(), gomock.Len(1)).
		DoAndReturn(func(_ context.Context, rows []*domain.Deployment) error {
			rows[0].ID = "dep_e"
			assert.Equal(t, "rel_1", rows[0].ReleaseID)
			assert.Equal(t, domain.DeploymentReasonRollback, rows[0].Metadata.Reason)
			assert.Equal(t, "dpl_2", *rows[0].Metadata.RollbackOf)
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
	assert.Equal(t, "dpl_3", result.DeployID)
	require.Len(t, result.Warnings, 1)
	assert.Contains(t, result.Warnings[0], "https://app.acme.com: no earlier release")
}

// Expanding hydrates the page's releases in one batched, deduplicated read —
// a history is many deployments of few releases.
func TestDeploymentServiceListExpandsReleases(t *testing.T) {
	svc, m := newMockedDeploymentService(t)

	items := []*domain.Deployment{
		{ProjectID: "proj_1", ID: "dep_1", ReleaseID: "rel_a"},
		{ProjectID: "proj_1", ID: "dep_2", ReleaseID: "rel_b"},
		{ProjectID: "proj_1", ID: "dep_3", ReleaseID: "rel_a"},
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

// The live view is the newest row per target with the preview expiry joined
// in, and nothing else.
func TestDeploymentServiceListLive(t *testing.T) {
	svc, m := newMockedDeploymentService(t)
	m.statements.EXPECT().ListLiveDeployments(gomock.Any(), "proj_1").Return([]*domain.Deployment{
		{ProjectID: "proj_1", ID: "dep_1", Origin: "", ReleaseID: "rel_a"},
		{ProjectID: "proj_1", ID: "dep_2", Origin: "https://pr-1-acme.vercel.app", ReleaseID: "rel_b"},
	}, nil)
	expires := time.Now().Add(time.Hour)
	m.statements.EXPECT().ListOrigins(gomock.Any(), "proj_1").Return([]*domain.Origin{
		{ProjectID: "proj_1", Origin: "https://pr-1-acme.vercel.app", ExpiresAt: expires},
	}, nil)

	result, err := svc.List(t.Context(), service.ListDeploymentsInput{ProjectID: "proj_1", Live: true})
	require.NoError(t, err)
	require.Len(t, result.Items, 2)
	assert.Nil(t, result.ReleasesByID)
	assert.Equal(t, expires, result.ExpiresAt["https://pr-1-acme.vercel.app"])
	_, hasDefault := result.ExpiresAt[""]
	assert.False(t, hasDefault)
}
