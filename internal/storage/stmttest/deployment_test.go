//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/deployment"
)

func ensureDeploymentProject(t *testing.T, stmts service.AllStatements) string {
	t.Helper()
	projectID := "proj-dep-" + uniqueSuffix(t)
	require.NoError(t, stmts.CreateProject(t.Context(), newTestProject(projectID)))
	t.Cleanup(func() { _, _ = stmts.DeleteProjectByID(context.Background(), projectID) })
	return projectID
}

func createDeployment(t *testing.T, stmts service.AllStatements, entity *domain.Deployment, expected *string) *domain.Deployment {
	t.Helper()
	created, err := stmts.CreateDeployment(t.Context(), entity, expected)
	require.NoError(t, err)
	require.True(t, created, "expected a new deployment, got the idempotent answer %s", entity.ID)
	return entity
}

func mustNewDeployment(t *testing.T, projectID, environmentID, releaseID string, reason domain.DeploymentReason, source *string) *domain.Deployment {
	t.Helper()
	entity, err := domain.NewDeployment(projectID, environmentID, releaseID, domain.DeploymentMetadata{
		Reason:              reason,
		SourceEnvironmentID: source,
	})
	require.NoError(t, err)
	return entity
}

func TestDeploymentStatements_CreateAndGetByID(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)
		env := createEnvironment(t, d.stmts, projectID, "prod")
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})

		entity := mustNewDeployment(t, projectID, env.ID, rel.ID, domain.DeploymentReasonDeploy, nil)
		entity.Metadata.DeployedBy = new("user_1")
		entity.Metadata.DeployedByType = new(domain.EventActorTypeHuman)
		createDeployment(t, d.stmts, entity, nil)

		// The id is minted by the dialect, not the caller (ADR 047).
		assert.True(t, domain.PrefixDeployment.Matches(entity.ID), "id %q is not dep_-prefixed", entity.ID)
		assert.False(t, entity.DeployedAt.IsZero())
		assert.WithinDuration(t, time.Now(), entity.DeployedAt, 5*time.Second)

		scope, err := d.stmts.GetResourceScopeInProject(t.Context(), domain.ResourceKindDeployment, projectID, entity.ID)
		require.NoError(t, err)
		assert.Equal(t, domain.ResourceKindDeployment, scope.ResourceKind)
		assert.Nil(t, scope.TeamID)

		got, err := d.stmts.GetDeploymentByID(t.Context(), projectID, entity.ID)
		require.NoError(t, err)
		assert.Equal(t, entity.ProjectID, got.ProjectID)
		assert.Equal(t, entity.ID, got.ID)
		assert.Equal(t, env.ID, got.EnvironmentID)
		assert.Equal(t, rel.ID, got.ReleaseID)
		assert.Equal(t, domain.DeploymentReasonDeploy, got.Metadata.Reason)
		assert.Nil(t, got.Metadata.SourceEnvironmentID)
		assert.Equal(t, "user_1", *got.Metadata.DeployedBy)
		assert.Equal(t, domain.EventActorTypeHuman, *got.Metadata.DeployedByType)
		assert.Equal(t, entity.DeployedAt, got.DeployedAt)

		// The create swapped the environment's pointer in the same
		// transaction.
		gotEnv, err := d.stmts.GetEnvironmentByName(t.Context(), projectID, "prod")
		require.NoError(t, err)
		require.NotNil(t, gotEnv.CurrentDeploymentID)
		assert.Equal(t, entity.ID, *gotEnv.CurrentDeploymentID)
	})
}

// A deployment with no user identity behind it — a project secret used from
// CI — carries nil actor fields, which has to survive the round trip rather
// than coming back as empty strings.
func TestDeploymentStatements_NilActorRoundTrips(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)
		env := createEnvironment(t, d.stmts, projectID, "prod")
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})

		entity := createDeployment(t, d.stmts,
			mustNewDeployment(t, projectID, env.ID, rel.ID, domain.DeploymentReasonDeploy, nil), nil)

		got, err := d.stmts.GetDeploymentByID(t.Context(), projectID, entity.ID)
		require.NoError(t, err)
		assert.Nil(t, got.Metadata.DeployedBy)
		assert.Nil(t, got.Metadata.DeployedByType)
		assert.Nil(t, got.Metadata.SourceEnvironmentID)
	})
}

func TestDeploymentStatements_SecondCreateReplacesCurrent(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)
		env := createEnvironment(t, d.stmts, projectID, "prod")
		relA := createRelease(t, d.stmts, projectID, "000a", domain.ReleaseMetadata{})
		relB := createRelease(t, d.stmts, projectID, "000b", domain.ReleaseMetadata{})

		first := createDeployment(t, d.stmts,
			mustNewDeployment(t, projectID, env.ID, relA.ID, domain.DeploymentReasonDeploy, nil), nil)
		second := createDeployment(t, d.stmts,
			mustNewDeployment(t, projectID, env.ID, relB.ID, domain.DeploymentReasonDeploy, nil), nil)

		gotEnv, err := d.stmts.GetEnvironmentByName(t.Context(), projectID, "prod")
		require.NoError(t, err)
		require.NotNil(t, gotEnv.CurrentDeploymentID)
		assert.Equal(t, second.ID, *gotEnv.CurrentDeploymentID)

		// Both rows exist: the log is append-only, replacement is only the
		// pointer moving.
		for _, id := range []string{first.ID, second.ID} {
			_, err := d.stmts.GetDeploymentByID(t.Context(), projectID, id)
			assert.NoError(t, err)
		}
	})
}

// A promotion records where the release came from, as it stood at deployment
// time.
func TestDeploymentStatements_PromoteRecordsSource(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)
		dev := createEnvironment(t, d.stmts, projectID, "dev")
		prod := createEnvironment(t, d.stmts, projectID, "prod")
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})

		entity := createDeployment(t, d.stmts,
			mustNewDeployment(t, projectID, prod.ID, rel.ID, domain.DeploymentReasonPromote, &dev.ID), nil)

		got, err := d.stmts.GetDeploymentByID(t.Context(), projectID, entity.ID)
		require.NoError(t, err)
		assert.Equal(t, domain.DeploymentReasonPromote, got.Metadata.Reason)
		require.NotNil(t, got.Metadata.SourceEnvironmentID)
		assert.Equal(t, dev.ID, *got.Metadata.SourceEnvironmentID)
	})
}

func TestDeploymentStatements_ExpectedCurrentGuard(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)
		env := createEnvironment(t, d.stmts, projectID, "prod")
		relA := createRelease(t, d.stmts, projectID, "000a", domain.ReleaseMetadata{})
		relB := createRelease(t, d.stmts, projectID, "000b", domain.ReleaseMetadata{})

		// Expecting a deployment while the environment has none is a
		// mismatch with empty details: nothing runs there.
		_, err := d.stmts.CreateDeployment(t.Context(),
			mustNewDeployment(t, projectID, env.ID, relA.ID, domain.DeploymentReasonDeploy, nil),
			new("dep_not_current"))
		de, ok := errors.AsType[domain.Error](err)
		require.True(t, ok, "expected a domain error, got %v", err)
		assert.Equal(t, domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{}).Code, de.Code)
		assert.Equal(t, domain.DeploymentConflictDetails{}, de.Details)

		first := createDeployment(t, d.stmts,
			mustNewDeployment(t, projectID, env.ID, relA.ID, domain.DeploymentReasonDeploy, nil), nil)

		// A matching expectation passes.
		second := createDeployment(t, d.stmts,
			mustNewDeployment(t, projectID, env.ID, relB.ID, domain.DeploymentReasonDeploy, nil), &first.ID)

		// A stale expectation fails and reports what actually runs, and the
		// failed attempt writes nothing.
		_, err = d.stmts.CreateDeployment(t.Context(),
			mustNewDeployment(t, projectID, env.ID, relA.ID, domain.DeploymentReasonRollback, nil),
			&first.ID)
		de, ok = errors.AsType[domain.Error](err)
		require.True(t, ok, "expected a domain error, got %v", err)
		assert.Equal(t, domain.DeploymentConflictDetails{
			CurrentDeploymentID: second.ID,
			CurrentReleaseID:    relB.ID,
		}, de.Details)

		gotEnv, err := d.stmts.GetEnvironmentByName(t.Context(), projectID, "prod")
		require.NoError(t, err)
		assert.Equal(t, second.ID, *gotEnv.CurrentDeploymentID)
	})
}

func TestDeploymentStatements_UnknownEnvironmentIsNoRowFound(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})

		_, err := d.stmts.CreateDeployment(t.Context(),
			mustNewDeployment(t, projectID, "env_does_not_exist", rel.ID, domain.DeploymentReasonDeploy, nil), nil)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestDeploymentStatements_UnknownReleaseIsForeignKeyError(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)
		env := createEnvironment(t, d.stmts, projectID, "prod")

		_, err := d.stmts.CreateDeployment(t.Context(),
			mustNewDeployment(t, projectID, env.ID, "rel_does_not_exist", domain.DeploymentReasonDeploy, nil), nil)
		assert.ErrorIs(t, err, new(database.ForeignKeyError))

		// The refused insert left the pointer alone.
		gotEnv, err := d.stmts.GetEnvironmentByName(t.Context(), projectID, "prod")
		require.NoError(t, err)
		assert.Nil(t, gotEnv.CurrentDeploymentID)
	})
}

func TestDeploymentStatements_GetByIDUnknownIsNoRowFound(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)

		_, err := d.stmts.GetDeploymentByID(t.Context(), projectID, "dep_does_not_exist")
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestDeploymentStatements_GetByIDs(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)
		dev := createEnvironment(t, d.stmts, projectID, "dev")
		prod := createEnvironment(t, d.stmts, projectID, "prod")
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})

		onDev := createDeployment(t, d.stmts,
			mustNewDeployment(t, projectID, dev.ID, rel.ID, domain.DeploymentReasonDeploy, nil), nil)
		onProd := createDeployment(t, d.stmts,
			mustNewDeployment(t, projectID, prod.ID, rel.ID, domain.DeploymentReasonDeploy, nil), nil)

		// Unknown ids are simply absent, not an error: the caller hydrates
		// whatever pointers it holds.
		got, err := d.stmts.GetDeploymentsByIDs(t.Context(), projectID,
			[]string{onDev.ID, onProd.ID, "dep_does_not_exist"})
		require.NoError(t, err)
		gotIDs := make([]string, 0, len(got))
		for _, entity := range got {
			gotIDs = append(gotIDs, entity.ID)
		}
		assert.ElementsMatch(t, []string{onDev.ID, onProd.ID}, gotIDs)

		empty, err := d.stmts.GetDeploymentsByIDs(t.Context(), projectID, nil)
		require.NoError(t, err)
		assert.Empty(t, empty)
	})
}

func TestDeploymentStatements_ListNewestFirst(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)
		dev := createEnvironment(t, d.stmts, projectID, "dev")
		prod := createEnvironment(t, d.stmts, projectID, "prod")
		relA := createRelease(t, d.stmts, projectID, "000a", domain.ReleaseMetadata{})
		relB := createRelease(t, d.stmts, projectID, "000b", domain.ReleaseMetadata{})

		first := createDeployment(t, d.stmts,
			mustNewDeployment(t, projectID, prod.ID, relA.ID, domain.DeploymentReasonDeploy, nil), nil)
		onDev := createDeployment(t, d.stmts,
			mustNewDeployment(t, projectID, dev.ID, relA.ID, domain.DeploymentReasonDeploy, nil), nil)
		second := createDeployment(t, d.stmts,
			mustNewDeployment(t, projectID, prod.ID, relB.ID, domain.DeploymentReasonRollback, nil), nil)

		// Filtered to prod: its history, current first, dev's row absent.
		result, err := d.stmts.ListDeployments(unfilteredListCtx(t), deployment.ListOptions(projectID, &prod.ID, 10))
		require.NoError(t, err)
		require.Len(t, result.Items, 2)
		assert.Equal(t, second.ID, result.Items[0].ID)
		assert.Equal(t, first.ID, result.Items[1].ID)

		// Unfiltered: every environment of the project, newest first.
		result, err = d.stmts.ListDeployments(unfilteredListCtx(t), deployment.ListOptions(projectID, nil, 10))
		require.NoError(t, err)
		require.Len(t, result.Items, 3)
		assert.Equal(t, second.ID, result.Items[0].ID)
		assert.Equal(t, onDev.ID, result.Items[1].ID)
		assert.Equal(t, first.ID, result.Items[2].ID)
	})
}

// Deleting the project cascades environments, releases and deployments away
// together. The release FK is CASCADE rather than NO ACTION exactly so this
// works regardless of which child table the cascade reaches first.
func TestDeploymentStatements_ProjectDeleteCascades(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := "proj-dep-del-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateProject(t.Context(), newTestProject(projectID)))
		env := createEnvironment(t, d.stmts, projectID, "prod")
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		entity := createDeployment(t, d.stmts,
			mustNewDeployment(t, projectID, env.ID, rel.ID, domain.DeploymentReasonDeploy, nil), nil)

		_, err := d.stmts.DeleteProjectByID(t.Context(), projectID)
		require.NoError(t, err)

		_, err = d.stmts.GetDeploymentByID(t.Context(), projectID, entity.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// Deploying the release an environment already runs writes nothing and
// answers with the deployment that made it live; the same release returning
// after something else ran in between is a new act and a new row.
func TestDeploymentStatements_CreateIsIdempotentOnRunningRelease(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)
		env := createEnvironment(t, d.stmts, projectID, "prod")
		relA := createRelease(t, d.stmts, projectID, "000a", domain.ReleaseMetadata{})
		relB := createRelease(t, d.stmts, projectID, "000b", domain.ReleaseMetadata{})

		first := createDeployment(t, d.stmts,
			mustNewDeployment(t, projectID, env.ID, relA.ID, domain.DeploymentReasonDeploy, nil), nil)

		// Same release again: no new row, and the entity is overwritten with
		// the record that made it live — its reason and timestamp, not this
		// call's.
		again := mustNewDeployment(t, projectID, env.ID, relA.ID, domain.DeploymentReasonRollback, nil)
		created, err := d.stmts.CreateDeployment(t.Context(), again, nil)
		require.NoError(t, err)
		assert.False(t, created)
		assert.Equal(t, first.ID, again.ID)
		assert.Equal(t, domain.DeploymentReasonDeploy, again.Metadata.Reason)
		assert.Equal(t, first.DeployedAt, again.DeployedAt)

		// A matching guard combined with the idempotent answer still passes.
		guarded := mustNewDeployment(t, projectID, env.ID, relA.ID, domain.DeploymentReasonDeploy, nil)
		created, err = d.stmts.CreateDeployment(t.Context(), guarded, &first.ID)
		require.NoError(t, err)
		assert.False(t, created)

		// Something else runs, then relA returns: that is a new act.
		createDeployment(t, d.stmts,
			mustNewDeployment(t, projectID, env.ID, relB.ID, domain.DeploymentReasonDeploy, nil), nil)
		back := createDeployment(t, d.stmts,
			mustNewDeployment(t, projectID, env.ID, relA.ID, domain.DeploymentReasonRollback, nil), nil)
		assert.NotEqual(t, first.ID, back.ID)

		result, err := d.stmts.ListDeployments(unfilteredListCtx(t), deployment.ListOptions(projectID, &env.ID, 10))
		require.NoError(t, err)
		assert.Len(t, result.Items, 3, "two idempotent answers wrote nothing")
	})
}
