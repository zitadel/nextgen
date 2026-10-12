//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"errors"
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
	expected *string
	ttl      time.Duration
}

// deploy creates a deployment that must not fail and reports whether it was
// written.
func deploy(t *testing.T, stmts service.AllStatements, projectID, releaseID string, origins []string, args deployArgs) (*domain.Deployment, bool) {
	t.Helper()
	entity, created, err := createDeployment(t, stmts, projectID, releaseID, origins, args)
	require.NoError(t, err)
	return entity, created
}

// tryDeploy creates a deployment that is expected to fail.
func tryDeploy(t *testing.T, stmts service.AllStatements, projectID, releaseID string, origins []string, args deployArgs) (*domain.Deployment, error) {
	t.Helper()
	entity, _, err := createDeployment(t, stmts, projectID, releaseID, origins, args)
	return entity, err
}

func createDeployment(t *testing.T, stmts service.AllStatements, projectID, releaseID string, origins []string, args deployArgs) (*domain.Deployment, bool, error) {
	t.Helper()
	entity, err := domain.NewDeployment(projectID, releaseID, args.kind, origins, args.metadata)
	require.NoError(t, err)
	created, err := stmts.CreateDeployment(t.Context(), entity, args.expected, args.ttl)
	return entity, created, err
}

func previewDeploy(ttl time.Duration) deployArgs {
	return deployArgs{kind: domain.DeploymentTargetKindPreview, ttl: ttl}
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

func assertConflict(t *testing.T, err error, want *domain.Deployment) {
	t.Helper()
	require.Error(t, err)
	de, ok := errors.AsType[domain.Error](err)
	require.True(t, ok, "expected a domain error, got %T: %v", err, err)
	assert.Equal(t, domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{}).Code, de.Code)
	details, ok := de.Details.(domain.DeploymentConflictDetails)
	require.True(t, ok, "conflict details are %T", de.Details)
	if want == nil {
		assert.Nil(t, details.Deployment)
		return
	}
	require.NotNil(t, details.Deployment)
	assert.Equal(t, want.ID, details.Deployment.ID)
	assert.Equal(t, want.ReleaseID, details.Deployment.ReleaseID)
}

// One deployment over several targets is one operation: one id, one
// deployed_at, every target, and each target now serves it.
func TestDeploymentStatements_FanOutIsOneOperation(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})

		dep, created := deploy(t, d.stmts, projectID, rel.ID, []string{wwwOrigin, appOrigin}, deployArgs{
			metadata: domain.DeploymentMetadata{
				Message:        new("add phone_number"),
				DeployedBy:     new("user_1"),
				DeployedByType: new(domain.EventActorTypeHuman),
			},
		})
		assert.True(t, created)
		assert.True(t, domain.PrefixDeployment.Matches(dep.ID), "id %q is not dep_-prefixed", dep.ID)
		assert.WithinDuration(t, time.Now(), dep.DeployedAt, 5*time.Second)

		got, err := d.stmts.GetDeploymentByID(t.Context(), projectID, dep.ID)
		require.NoError(t, err)
		assert.Equal(t, rel.ID, got.ReleaseID)
		assert.Equal(t, domain.DeploymentTargetKindPrimary, got.TargetKind)
		assert.Equal(t, []string{appOrigin, wwwOrigin}, got.Origins(), "targets come back sorted")
		assert.True(t, dep.DeployedAt.Equal(got.DeployedAt))
		assert.Equal(t, domain.DeploymentReasonDeploy, got.Metadata.Reason)
		assert.Equal(t, "add phone_number", *got.Metadata.Message)
		assert.Nil(t, got.Metadata.RollbackTo)
		assert.Equal(t, "user_1", *got.Metadata.DeployedBy)
		assert.Equal(t, domain.EventActorTypeHuman, *got.Metadata.DeployedByType)

		for _, origin := range []string{appOrigin, wwwOrigin} {
			newest, err := d.stmts.NewestDeployment(t.Context(), projectID, origin)
			require.NoError(t, err)
			assert.Equal(t, dep.ID, newest.ID, origin)
		}

		scope, err := d.stmts.GetResourceScopeInProject(t.Context(), domain.ResourceKindDeployment, projectID, dep.ID)
		require.NoError(t, err)
		assert.Equal(t, projectID, scope.ProjectID)
	})
}

// A fresh project has nothing deployed: no newest, no point in time, an empty
// live view and an empty history.
func TestDeploymentStatements_FreshProject(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)

		_, err := d.stmts.NewestDeployment(t.Context(), projectID, appOrigin)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		_, err = d.stmts.DeploymentAt(t.Context(), projectID, appOrigin, time.Now())
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		assert.Empty(t, live(t, d.stmts, projectID, time.Now(), deployment.LiveFilter{}))
		assert.Empty(t, history(t, d.stmts, projectID, appOrigin))
	})
}

// A rollback appends: the earlier deployments stay as they were, the new one
// names what it re-applied, and the targets serve it.
func TestDeploymentStatements_RollbackAppends(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		relOld := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		relNew := createRelease(t, d.stmts, projectID, "0002", domain.ReleaseMetadata{})
		origins := []string{appOrigin, wwwOrigin}

		first, _ := deploy(t, d.stmts, projectID, relOld.ID, origins, deployArgs{})
		second, _ := deploy(t, d.stmts, projectID, relNew.ID, origins, deployArgs{})
		rollback, created := deploy(t, d.stmts, projectID, relOld.ID, origins, deployArgs{
			metadata: domain.DeploymentMetadata{
				Reason:     domain.DeploymentReasonRollback,
				Message:    new("phone_number broke sign-up"),
				RollbackTo: new(first.ID),
			},
		})
		require.True(t, created)

		got, err := d.stmts.GetDeploymentByID(t.Context(), projectID, rollback.ID)
		require.NoError(t, err)
		assert.Equal(t, domain.DeploymentReasonRollback, got.Metadata.Reason)
		assert.Equal(t, first.ID, *got.Metadata.RollbackTo)

		unchanged, err := d.stmts.GetDeploymentByID(t.Context(), projectID, first.ID)
		require.NoError(t, err)
		assert.True(t, first.DeployedAt.Equal(unchanged.DeployedAt))
		assert.Equal(t, origins, unchanged.Origins())

		newest, err := d.stmts.NewestDeployment(t.Context(), projectID, appOrigin)
		require.NoError(t, err)
		assert.Equal(t, rollback.ID, newest.ID)

		assert.Equal(t, []string{rollback.ID, second.ID, first.ID}, deploymentIDs(history(t, d.stmts, projectID, appOrigin)))
	})
}

// What an origin served at an instant is the newest deployment no later than
// it, and nothing before the first deploy.
func TestDeploymentStatements_DeploymentAt(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		relA := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		relB := createRelease(t, d.stmts, projectID, "0002", domain.ReleaseMetadata{})

		first, _ := deploy(t, d.stmts, projectID, relA.ID, []string{appOrigin}, deployArgs{})
		second, _ := deploy(t, d.stmts, projectID, relB.ID, []string{appOrigin}, deployArgs{})
		require.True(t, second.DeployedAt.After(first.DeployedAt))

		_, err := d.stmts.DeploymentAt(t.Context(), projectID, appOrigin, first.DeployedAt.Add(-time.Microsecond))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		at, err := d.stmts.DeploymentAt(t.Context(), projectID, appOrigin, first.DeployedAt)
		require.NoError(t, err)
		assert.Equal(t, first.ID, at.ID, "the instant of a deploy already serves it")

		at, err = d.stmts.DeploymentAt(t.Context(), projectID, appOrigin, second.DeployedAt.Add(-time.Microsecond))
		require.NoError(t, err)
		assert.Equal(t, first.ID, at.ID)

		at, err = d.stmts.DeploymentAt(t.Context(), projectID, appOrigin, time.Now().Add(time.Hour))
		require.NoError(t, err)
		assert.Equal(t, second.ID, at.ID)

		_, err = d.stmts.DeploymentAt(t.Context(), projectID, wwwOrigin, time.Now())
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// Deploying the release every target already serves writes nothing and
// answers with the newest deployment to them. One target that serves
// something else makes it a write.
func TestDeploymentStatements_IdempotentWhenEveryTargetServesTheRelease(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})

		first, _ := deploy(t, d.stmts, projectID, rel.ID, []string{appOrigin, wwwOrigin}, deployArgs{})

		again, created := deploy(t, d.stmts, projectID, rel.ID, []string{wwwOrigin, appOrigin}, deployArgs{})
		assert.False(t, created)
		assert.Equal(t, first.ID, again.ID)
		assert.Equal(t, first.Origins(), again.Origins())

		subset, created := deploy(t, d.stmts, projectID, rel.ID, []string{appOrigin}, deployArgs{})
		assert.False(t, created)
		assert.Equal(t, first.ID, subset.ID)

		wider, created := deploy(t, d.stmts, projectID, rel.ID, []string{appOrigin, gitOrigin}, deployArgs{})
		assert.True(t, created, "a target that serves nothing yet makes it a write")
		assert.NotEqual(t, first.ID, wider.ID)

		assert.Len(t, history(t, d.stmts, projectID, appOrigin), 2)
	})
}

// The guard compares against the newest deployment to any of the targets,
// not to the first one, and carries it on a mismatch.
func TestDeploymentStatements_GuardSpansEveryTarget(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		relA := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		relB := createRelease(t, d.stmts, projectID, "0002", domain.ReleaseMetadata{})
		relC := createRelease(t, d.stmts, projectID, "0003", domain.ReleaseMetadata{})

		// Nothing deployed yet: expecting any deployment is a conflict with
		// none.
		_, err := tryDeploy(t, d.stmts, projectID, relA.ID, []string{appOrigin}, deployArgs{expected: new("dep_nothing")})
		assertConflict(t, err, nil)

		onApp, _ := deploy(t, d.stmts, projectID, relA.ID, []string{appOrigin}, deployArgs{})
		onWWW, _ := deploy(t, d.stmts, projectID, relB.ID, []string{wwwOrigin}, deployArgs{})

		// appOrigin sorts first, but wwwOrigin's deployment is newer.
		_, err = tryDeploy(t, d.stmts, projectID, relC.ID, []string{appOrigin, wwwOrigin}, deployArgs{expected: new(onApp.ID)})
		assertConflict(t, err, onWWW)
		assert.Len(t, history(t, d.stmts, projectID, appOrigin), 1, "a refused deploy writes nothing")

		dep, created := deploy(t, d.stmts, projectID, relC.ID, []string{appOrigin, wwwOrigin}, deployArgs{expected: new(onWWW.ID)})
		assert.True(t, created)

		// A stale guard is refused even when the release would be a no-op.
		_, err = tryDeploy(t, d.stmts, projectID, relC.ID, []string{appOrigin, wwwOrigin}, deployArgs{expected: new(onWWW.ID)})
		assertConflict(t, err, dep)
	})
}

// Concurrent deploys guarded on the same newest deployment are serialised:
// exactly one writes, and every other sees that one as the newest.
func TestDeploymentStatements_ConcurrentDeploysSerialise(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		base := createRelease(t, d.stmts, projectID, "base", domain.ReleaseMetadata{})
		start, _ := deploy(t, d.stmts, projectID, base.ID, []string{appOrigin}, deployArgs{})

		const racers = 4
		releases := make([]*domain.Release, racers)
		for i := range racers {
			releases[i] = createRelease(t, d.stmts, projectID, string(rune('a'+i)), domain.ReleaseMetadata{})
		}

		type outcome struct {
			entity *domain.Deployment
			err    error
		}
		outcomes := make([]outcome, racers)
		var wg sync.WaitGroup
		for i := range racers {
			wg.Go(func() {
				entity, err := domain.NewDeployment(projectID, releases[i].ID, domain.DeploymentTargetKindPrimary, []string{appOrigin}, domain.DeploymentMetadata{})
				if err == nil {
					_, err = d.stmts.CreateDeployment(t.Context(), entity, new(start.ID), 0)
				}
				outcomes[i] = outcome{entity: entity, err: err}
			})
		}
		wg.Wait()

		var winner *domain.Deployment
		for _, o := range outcomes {
			if o.err == nil {
				require.Nil(t, winner, "two racers wrote")
				winner = o.entity
			}
		}
		require.NotNil(t, winner, "no racer wrote")
		for _, o := range outcomes {
			if o.err != nil {
				assertConflict(t, o.err, winner)
			}
		}

		newest, err := d.stmts.NewestDeployment(t.Context(), projectID, appOrigin)
		require.NoError(t, err)
		assert.Equal(t, winner.ID, newest.ID)
		assert.Len(t, history(t, d.stmts, projectID, appOrigin), 2)
	})
}

// Every deploy to a target is stamped after the one it supersedes, so the
// newest deployment is always the last written.
func TestDeploymentStatements_LaterDeployIsNewer(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		var previous *domain.Deployment
		for i := range 5 {
			rel := createRelease(t, d.stmts, projectID, string(rune('a'+i)), domain.ReleaseMetadata{})
			dep, _ := deploy(t, d.stmts, projectID, rel.ID, []string{appOrigin}, deployArgs{})
			if previous != nil {
				assert.True(t, dep.DeployedAt.After(previous.DeployedAt), "deploy %d is not later", i)
			}
			newest, err := d.stmts.NewestDeployment(t.Context(), projectID, appOrigin)
			require.NoError(t, err)
			assert.Equal(t, dep.ID, newest.ID)
			previous = dep
		}
	})
}

// The live view lists each deployment some target still serves, narrowed to
// those targets, and drops a preview URL once its preview has expired.
func TestDeploymentStatements_LiveView(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		relA := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		relB := createRelease(t, d.stmts, projectID, "0002", domain.ReleaseMetadata{})

		primaries, _ := deploy(t, d.stmts, projectID, relA.ID, []string{appOrigin, wwwOrigin}, deployArgs{})
		previews, _ := deploy(t, d.stmts, projectID, relB.ID, []string{gitOrigin, shaOrigin}, previewDeploy(time.Hour))
		appOnly, _ := deploy(t, d.stmts, projectID, relB.ID, []string{appOrigin}, deployArgs{})

		now := time.Now()
		got := live(t, d.stmts, projectID, now, deployment.LiveFilter{})
		require.Equal(t, []string{appOnly.ID, previews.ID, primaries.ID}, deploymentIDs(got))
		assert.Equal(t, []string{appOrigin}, got[0].Origins())
		assert.Equal(t, []string{gitOrigin, shaOrigin}, got[1].Origins())
		assert.Equal(t, []string{wwwOrigin}, got[2].Origins(), "narrowed to the target it still serves")

		byOrigin := live(t, d.stmts, projectID, now, deployment.LiveFilter{Origin: new(wwwOrigin)})
		assert.Equal(t, []string{primaries.ID}, deploymentIDs(byOrigin))

		byRelease := live(t, d.stmts, projectID, now, deployment.LiveFilter{ReleaseID: new(relB.ID)})
		assert.Equal(t, []string{appOnly.ID, previews.ID}, deploymentIDs(byRelease))

		// Past the previews' expiry their URLs serve nothing, swept or not,
		// and their history stays.
		later := now.Add(2 * time.Hour)
		assert.Equal(t, []string{appOnly.ID, primaries.ID}, deploymentIDs(live(t, d.stmts, projectID, later, deployment.LiveFilter{})))
		for _, origin := range []string{gitOrigin, shaOrigin} {
			swept, err := d.stmts.DeleteExpiredPreview(t.Context(), projectID, origin, later)
			require.NoError(t, err)
			assert.True(t, swept)
		}
		assert.Equal(t, []string{appOnly.ID, primaries.ID}, deploymentIDs(live(t, d.stmts, projectID, now, deployment.LiveFilter{})))
		assert.Equal(t, []string{previews.ID}, deploymentIDs(history(t, d.stmts, projectID, gitOrigin)))
		newest, err := d.stmts.NewestDeployment(t.Context(), projectID, gitOrigin)
		require.NoError(t, err)
		assert.Equal(t, previews.ID, newest.ID)
	})
}

// A target keeps its history after the thing that admitted it is gone: once
// nothing deploys to an origin again, its deployments are still read back
// whole, and the deployments that covered it still list it as a target.
func TestDeploymentStatements_HistoryOutlivesTheTarget(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		relA := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		relB := createRelease(t, d.stmts, projectID, "0002", domain.ReleaseMetadata{})

		both, _ := deploy(t, d.stmts, projectID, relA.ID, []string{appOrigin, wwwOrigin}, deployArgs{})
		// The www pattern is removed: later deploys to the primaries cover
		// app alone.
		appOnly, _ := deploy(t, d.stmts, projectID, relB.ID, []string{appOrigin}, deployArgs{})

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

		first, _ := deploy(t, d.stmts, projectID, rel.ID, []string{appOrigin}, deployArgs{})
		second, _ := deploy(t, d.stmts, projectID, rel.ID, []string{wwwOrigin}, deployArgs{})
		deploy(t, d.stmts, otherProject, otherRel.ID, []string{appOrigin}, deployArgs{})

		result, err := d.stmts.ListDeployments(unfilteredListCtx(t), deployment.ListOptions(projectID, nil, 50))
		require.NoError(t, err)
		assert.Equal(t, []string{second.ID, first.ID}, deploymentIDs(result.Items))
		assert.Equal(t, []string{wwwOrigin}, result.Items[0].Origins())

		_, err = d.stmts.NewestDeployment(t.Context(), otherProject, wwwOrigin)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestDeploymentStatements_GetByIDs(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		a, _ := deploy(t, d.stmts, projectID, rel.ID, []string{appOrigin, wwwOrigin}, deployArgs{})
		b, _ := deploy(t, d.stmts, projectID, rel.ID, []string{gitOrigin}, previewDeploy(time.Hour))

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

// A deployment names a release of its own project, and a project that does
// not exist cannot be deployed to.
func TestDeploymentStatements_References(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)

		_, err := tryDeploy(t, d.stmts, projectID, "rel_does_not_exist", []string{appOrigin}, deployArgs{})
		assert.ErrorIs(t, err, new(database.ForeignKeyError))
		assert.Empty(t, history(t, d.stmts, projectID, appOrigin), "a refused deploy writes no target")

		_, err = tryDeploy(t, d.stmts, "proj_does_not_exist", "rel_does_not_exist", []string{appOrigin}, deployArgs{})
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// Deleting a project takes its deployments, their targets and its previews
// with it, even though a deployment holds its release.
func TestDeploymentStatements_ProjectDeleteCascades(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		dep, _ := deploy(t, d.stmts, projectID, rel.ID, []string{appOrigin}, deployArgs{})
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
