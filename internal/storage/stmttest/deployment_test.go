//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/deployment"
)

const (
	appOrigin = "https://app.acme.com"
	wwwOrigin = "https://www.acme.com"
	gitOrigin = "https://acme-git-sso-acmeinc.vercel.app"
	shaOrigin = "https://acme-k3x9v2-acmeinc.vercel.app"
)

type deployArgs struct {
	kind     domain.DeploymentTargetKind
	metadata domain.DeploymentMetadata
	ttl      time.Duration
}

func previewDeploy(ttl time.Duration) deployArgs {
	return deployArgs{kind: domain.DeploymentTargetKindPreview, ttl: ttl}
}

// deploy writes a deployment the way the service does: against what its
// targets serve, renewing previews for a preview deploy.
func deploy(t *testing.T, stmts service.AllStatements, projectID, releaseID string, origins []string, args deployArgs) *domain.Deployment {
	t.Helper()
	entity, err := tryDeploy(t, stmts, projectID, releaseID, origins, args)
	require.NoError(t, err)
	return entity
}

func tryDeploy(t *testing.T, stmts service.AllStatements, projectID, releaseID string, origins []string, args deployArgs) (*domain.Deployment, error) {
	t.Helper()
	entity, err := domain.NewDeployment(projectID, releaseID, args.kind, origins, args.metadata)
	require.NoError(t, err)
	serving, err := stmts.GetNewestTargets(t.Context(), projectID, entity.Origins())
	require.NoError(t, err)
	if err := stmts.CreateDeployment(t.Context(), entity, serving); err != nil {
		return entity, err
	}
	if args.kind == domain.DeploymentTargetKindPreview {
		require.NoError(t, stmts.UpsertPreviews(t.Context(), projectID, entity.Origins(), entity.DeployedAt.Add(args.ttl), entity.DeployedAt))
	}
	return entity, nil
}

func deploymentIDs(items []*domain.Deployment) []string {
	return deployment.DeploymentIDs(items)
}

func history(t *testing.T, stmts service.AllStatements, projectID, origin string) []*domain.Deployment {
	t.Helper()
	result, err := stmts.ListDeployments(unfilteredListCtx(t), deployment.ListOptions(projectID, &origin, 50))
	require.NoError(t, err)
	return result.Items
}

func live(t *testing.T, stmts service.AllStatements, projectID string, now time.Time, filter deployment.LiveFilter) []*domain.Deployment {
	t.Helper()
	result, err := stmts.ListLiveDeployments(unfilteredListCtx(t), now, deployment.LiveListOptions(projectID, now, filter, 50))
	require.NoError(t, err)
	return result.Items
}

// One deployment over several targets is one operation: one id, one
// deployed_at, every target, and each target now serves it.
func TestDeploymentStatements_FanOutIsOneOperation(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})

		dep := deploy(t, d.stmts, projectID, rel.ID, []string{wwwOrigin, appOrigin}, deployArgs{
			metadata: domain.DeploymentMetadata{
				Message:        new("add phone_number"),
				DeployedBy:     new("user_1"),
				DeployedByType: new(domain.EventActorTypeHuman),
			},
		})
		assert.True(t, domain.PrefixDeployment.Matches(dep.ID), "id %q is not dep_-prefixed", dep.ID)
		assert.WithinDuration(t, time.Now(), dep.DeployedAt, 5*time.Second)

		got, err := d.stmts.GetDeploymentByID(t.Context(), projectID, dep.ID)
		require.NoError(t, err)
		assert.Equal(t, rel.ID, got.ReleaseID)
		assert.Equal(t, domain.DeploymentTargetKindPrimary, got.TargetKind)
		assert.Equal(t, []string{appOrigin, wwwOrigin}, got.Origins())
		assert.True(t, dep.DeployedAt.Equal(got.DeployedAt))
		assert.Equal(t, "add phone_number", *got.Metadata.Message)
		assert.Nil(t, got.Metadata.RollbackTo)
		assert.Equal(t, "user_1", *got.Metadata.DeployedBy)
		assert.Equal(t, domain.EventActorTypeHuman, *got.Metadata.DeployedByType)

		serving, err := d.stmts.GetNewestTargets(t.Context(), projectID, []string{appOrigin, wwwOrigin})
		require.NoError(t, err)
		require.Len(t, serving, 2)
		for _, s := range serving {
			assert.Equal(t, dep.ID, s.DeploymentID)
			assert.Equal(t, rel.ID, s.ReleaseID)
			assert.True(t, dep.DeployedAt.Equal(s.DeployedAt))
		}

		scope, err := d.stmts.GetResourceScopeInProject(t.Context(), domain.ResourceKindDeployment, projectID, dep.ID)
		require.NoError(t, err)
		assert.Equal(t, projectID, scope.ProjectID)
	})
}

func TestDeploymentStatements_FreshProject(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)

		serving, err := d.stmts.GetNewestTargets(t.Context(), projectID, []string{appOrigin})
		require.NoError(t, err)
		assert.Empty(t, serving)
		assert.Empty(t, live(t, d.stmts, projectID, time.Now(), deployment.LiveFilter{}))
		assert.Empty(t, history(t, d.stmts, projectID, appOrigin))
	})
}

// GetNewestTargets answers per origin, for the named origins of the project only.
func TestDeploymentStatements_NewestTargets(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		otherProject := ensureReleaseProject(t, d.stmts)
		relA := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		relB := createRelease(t, d.stmts, projectID, "0002", domain.ReleaseMetadata{})
		otherRel := createRelease(t, d.stmts, otherProject, "0001", domain.ReleaseMetadata{})

		both := deploy(t, d.stmts, projectID, relA.ID, []string{appOrigin, wwwOrigin}, deployArgs{})
		appOnly := deploy(t, d.stmts, projectID, relB.ID, []string{appOrigin}, deployArgs{})
		deploy(t, d.stmts, projectID, relB.ID, []string{gitOrigin}, previewDeploy(time.Hour))
		deploy(t, d.stmts, otherProject, otherRel.ID, []string{wwwOrigin}, deployArgs{})

		serving, err := d.stmts.GetNewestTargets(t.Context(), projectID, []string{appOrigin, wwwOrigin, gitOrigin, shaOrigin})
		require.NoError(t, err)
		byOrigin := map[string]domain.TargetDeployment{}
		for _, s := range serving {
			byOrigin[s.Origin] = s
		}
		require.Len(t, byOrigin, 3, "an origin with nothing deployed has no row")
		assert.Equal(t, appOnly.ID, byOrigin[appOrigin].DeploymentID)
		assert.Equal(t, relB.ID, byOrigin[appOrigin].ReleaseID)
		assert.Equal(t, domain.DeploymentTargetKindPrimary, byOrigin[appOrigin].Kind)
		assert.Equal(t, both.ID, byOrigin[wwwOrigin].DeploymentID)
		assert.Equal(t, domain.DeploymentTargetKindPreview, byOrigin[gitOrigin].Kind)
	})
}

// A rollback appends: the earlier deployments stay as they were.
func TestDeploymentStatements_RollbackAppends(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		relOld := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		relNew := createRelease(t, d.stmts, projectID, "0002", domain.ReleaseMetadata{})
		origins := []string{appOrigin, wwwOrigin}

		first := deploy(t, d.stmts, projectID, relOld.ID, origins, deployArgs{})
		second := deploy(t, d.stmts, projectID, relNew.ID, origins, deployArgs{})
		rollback := deploy(t, d.stmts, projectID, relOld.ID, origins, deployArgs{
			metadata: domain.DeploymentMetadata{
				Reason:     domain.DeploymentReasonRollback,
				Message:    new("phone_number broke sign-up"),
				RollbackTo: new(first.ID),
			},
		})

		got, err := d.stmts.GetDeploymentByID(t.Context(), projectID, rollback.ID)
		require.NoError(t, err)
		assert.Equal(t, domain.DeploymentReasonRollback, got.Metadata.Reason)
		assert.Equal(t, first.ID, *got.Metadata.RollbackTo)

		unchanged, err := d.stmts.GetDeploymentByID(t.Context(), projectID, first.ID)
		require.NoError(t, err)
		assert.True(t, first.DeployedAt.Equal(unchanged.DeployedAt))

		assert.Equal(t, []string{rollback.ID, second.ID, first.ID}, deploymentIDs(history(t, d.stmts, projectID, appOrigin)))
	})
}

// The optimistic lock: deploys that insert against the same read all take
// the same seq, so exactly one writes and the others fail with a UniqueError,
// leaving no partial rows.
func TestDeploymentStatements_OptimisticLockAdmitsOneDeploy(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		base := createRelease(t, d.stmts, projectID, "base", domain.ReleaseMetadata{})
		deploy(t, d.stmts, projectID, base.ID, []string{appOrigin}, deployArgs{})
		read, err := d.stmts.GetNewestTargets(t.Context(), projectID, []string{appOrigin})
		require.NoError(t, err)

		const racers = 4
		releases := make([]*domain.Release, racers)
		for i := range racers {
			releases[i] = createRelease(t, d.stmts, projectID, string(rune('a'+i)), domain.ReleaseMetadata{})
		}
		errs := make([]error, racers)
		var wg sync.WaitGroup
		for i := range racers {
			wg.Go(func() {
				// wwwOrigin is new to every racer, appOrigin is contended:
				// a loser must not leave its www row behind.
				entity, err := domain.NewDeployment(projectID, releases[i].ID, domain.DeploymentTargetKindPrimary, []string{appOrigin, wwwOrigin}, domain.DeploymentMetadata{})
				if err == nil {
					err = d.stmts.CreateDeployment(context.Background(), entity, read)
				}
				errs[i] = err
			})
		}
		wg.Wait()

		won := 0
		for _, err := range errs {
			if err == nil {
				won++
				continue
			}
			assert.ErrorIs(t, err, new(database.UniqueError))
		}
		assert.Equal(t, 1, won)
		assert.Len(t, history(t, d.stmts, projectID, appOrigin), 2)
		assert.Len(t, history(t, d.stmts, projectID, wwwOrigin), 1)
	})
}

// The live view lists each deployment some target still serves, narrowed to
// those targets, and drops a preview URL once its preview has expired.
func TestDeploymentStatements_LiveView(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		relA := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		relB := createRelease(t, d.stmts, projectID, "0002", domain.ReleaseMetadata{})

		primaries := deploy(t, d.stmts, projectID, relA.ID, []string{appOrigin, wwwOrigin}, deployArgs{})
		previews := deploy(t, d.stmts, projectID, relB.ID, []string{gitOrigin, shaOrigin}, previewDeploy(time.Hour))
		appOnly := deploy(t, d.stmts, projectID, relB.ID, []string{appOrigin}, deployArgs{})

		now := time.Now()
		got := live(t, d.stmts, projectID, now, deployment.LiveFilter{})
		require.Equal(t, []string{appOnly.ID, previews.ID, primaries.ID}, deploymentIDs(got))
		assert.Equal(t, []string{appOrigin}, got[0].Origins())
		assert.Equal(t, []string{gitOrigin, shaOrigin}, got[1].Origins())
		assert.Equal(t, []string{wwwOrigin}, got[2].Origins())

		assert.Equal(t, []string{appOnly.ID, previews.ID}, deploymentIDs(live(t, d.stmts, projectID, now, deployment.LiveFilter{ReleaseID: new(relB.ID)})))

		later := now.Add(2 * time.Hour)
		assert.Equal(t, []string{appOnly.ID, primaries.ID}, deploymentIDs(live(t, d.stmts, projectID, later, deployment.LiveFilter{})))
		for _, origin := range []string{gitOrigin, shaOrigin} {
			swept, err := d.stmts.DeleteExpiredPreview(t.Context(), projectID, origin, later)
			require.NoError(t, err)
			assert.True(t, swept)
		}
		assert.Equal(t, []string{appOnly.ID, primaries.ID}, deploymentIDs(live(t, d.stmts, projectID, now, deployment.LiveFilter{})))
		assert.Equal(t, []string{previews.ID}, deploymentIDs(history(t, d.stmts, projectID, gitOrigin)))
	})
}

// GetLiveDeployment checks the origin and its liveness on the same target row:
// a deployment superseded on app but still live on www is what www serves,
// not what app serves.
func TestDeploymentStatements_LiveDeploymentOfOneOrigin(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		relA := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		relB := createRelease(t, d.stmts, projectID, "0002", domain.ReleaseMetadata{})

		both := deploy(t, d.stmts, projectID, relA.ID, []string{appOrigin, wwwOrigin}, deployArgs{})
		appOnly := deploy(t, d.stmts, projectID, relB.ID, []string{appOrigin}, deployArgs{})
		previews := deploy(t, d.stmts, projectID, relA.ID, []string{gitOrigin, shaOrigin}, previewDeploy(time.Hour))
		now := time.Now()

		got, err := d.stmts.GetLiveDeployment(t.Context(), projectID, appOrigin, now)
		require.NoError(t, err)
		assert.Equal(t, appOnly.ID, got.ID)

		got, err = d.stmts.GetLiveDeployment(t.Context(), projectID, wwwOrigin, now)
		require.NoError(t, err)
		assert.Equal(t, both.ID, got.ID)
		assert.Equal(t, []string{wwwOrigin}, got.Origins(), "narrowed to the targets it still serves")

		got, err = d.stmts.GetLiveDeployment(t.Context(), projectID, gitOrigin, now)
		require.NoError(t, err)
		assert.Equal(t, previews.ID, got.ID)

		// An expired preview serves nothing, even while its sibling lives.
		require.NoError(t, d.stmts.UpsertPreviews(t.Context(), projectID, []string{gitOrigin}, now.Add(-time.Minute), previews.DeployedAt))
		_, err = d.stmts.GetLiveDeployment(t.Context(), projectID, gitOrigin, now)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		got, err = d.stmts.GetLiveDeployment(t.Context(), projectID, shaOrigin, now)
		require.NoError(t, err)
		assert.Equal(t, []string{shaOrigin}, got.Origins())

		_, err = d.stmts.GetLiveDeployment(t.Context(), projectID, "https://nothing.acme.com", now)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// An origin no longer deployed to keeps its history.
func TestDeploymentStatements_HistoryOutlivesTheTarget(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		relA := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		relB := createRelease(t, d.stmts, projectID, "0002", domain.ReleaseMetadata{})

		both := deploy(t, d.stmts, projectID, relA.ID, []string{appOrigin, wwwOrigin}, deployArgs{})
		appOnly := deploy(t, d.stmts, projectID, relB.ID, []string{appOrigin}, deployArgs{})

		assert.Equal(t, []string{both.ID}, deploymentIDs(history(t, d.stmts, projectID, wwwOrigin)))
		got, err := d.stmts.GetDeploymentByID(t.Context(), projectID, both.ID)
		require.NoError(t, err)
		assert.Equal(t, []string{appOrigin, wwwOrigin}, got.Origins())
		assert.Equal(t, []string{appOnly.ID, both.ID}, deploymentIDs(history(t, d.stmts, projectID, appOrigin)))
	})
}

func TestDeploymentStatements_ListIsProjectScopedNewestFirst(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		otherProject := ensureReleaseProject(t, d.stmts)
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		otherRel := createRelease(t, d.stmts, otherProject, "0001", domain.ReleaseMetadata{})

		first := deploy(t, d.stmts, projectID, rel.ID, []string{appOrigin}, deployArgs{})
		second := deploy(t, d.stmts, projectID, rel.ID, []string{wwwOrigin}, deployArgs{})
		deploy(t, d.stmts, otherProject, otherRel.ID, []string{appOrigin}, deployArgs{})

		result, err := d.stmts.ListDeployments(unfilteredListCtx(t), deployment.ListOptions(projectID, nil, 50))
		require.NoError(t, err)
		assert.Equal(t, []string{second.ID, first.ID}, deploymentIDs(result.Items))
		assert.Equal(t, []string{wwwOrigin}, result.Items[0].Origins())

		assert.Empty(t, history(t, d.stmts, otherProject, wwwOrigin))
	})
}

func TestDeploymentStatements_GetByIDs(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		a := deploy(t, d.stmts, projectID, rel.ID, []string{appOrigin, wwwOrigin}, deployArgs{})
		b := deploy(t, d.stmts, projectID, rel.ID, []string{gitOrigin}, previewDeploy(time.Hour))

		got, err := d.stmts.GetDeploymentsByIDs(t.Context(), projectID, []string{a.ID, b.ID, "dep_does_not_exist"})
		require.NoError(t, err)
		byID := map[string]*domain.Deployment{}
		for _, entity := range got {
			byID[entity.ID] = entity
		}
		require.Len(t, byID, 2)
		assert.Equal(t, []string{appOrigin, wwwOrigin}, byID[a.ID].Origins())
		assert.Equal(t, domain.DeploymentTargetKindPreview, byID[b.ID].TargetKind)

		_, err = d.stmts.GetDeploymentByID(t.Context(), projectID, "dep_does_not_exist")
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// An unknown release or project trips the insert's foreign keys and writes
// nothing.
func TestDeploymentStatements_References(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)

		_, err := tryDeploy(t, d.stmts, projectID, "rel_does_not_exist", []string{appOrigin}, deployArgs{})
		assert.ErrorIs(t, err, new(database.ForeignKeyError))
		assert.Empty(t, history(t, d.stmts, projectID, appOrigin))

		_, err = tryDeploy(t, d.stmts, "proj_does_not_exist", "rel_does_not_exist", []string{appOrigin}, deployArgs{})
		assert.ErrorIs(t, err, new(database.ForeignKeyError))
	})
}

// Deleting a project takes its deployments, targets and previews with it,
// although a deployment holds its release.
func TestDeploymentStatements_ProjectDeleteCascades(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		dep := deploy(t, d.stmts, projectID, rel.ID, []string{appOrigin}, deployArgs{})
		deploy(t, d.stmts, projectID, rel.ID, []string{gitOrigin}, previewDeploy(time.Hour))

		_, err := d.stmts.DeleteProjectByID(t.Context(), projectID)
		require.NoError(t, err)

		_, err = d.stmts.GetDeploymentByID(t.Context(), projectID, dep.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		assert.Empty(t, history(t, d.stmts, projectID, appOrigin))
		_, err = d.stmts.GetPreview(t.Context(), projectID, gitOrigin)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}
