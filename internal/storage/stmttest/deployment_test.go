//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"crypto/rand"
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

func mustNewDeployment(t *testing.T, projectID, origin, releaseID string, reason domain.DeploymentReason, rollbackOf *string) *domain.Deployment {
	t.Helper()
	entity, err := domain.NewDeployment(projectID, origin, releaseID, domain.DeploymentMetadata{
		Reason:     reason,
		RollbackOf: rollbackOf,
	})
	require.NoError(t, err)
	return entity
}

// createDeploy writes one deploy of releaseID to every origin, under one
// deploy id, the way the service does: lock, insert, commit.
func createDeploy(t *testing.T, stmts service.AllStatements, projectID, releaseID string, origins ...string) []*domain.Deployment {
	t.Helper()
	deployID := domain.PrefixDeploy.IDPrefix(rand.Text())
	rows := make([]*domain.Deployment, 0, len(origins))
	for _, origin := range origins {
		entity := mustNewDeployment(t, projectID, origin, releaseID, domain.DeploymentReasonDeploy, nil)
		entity.DeployID = deployID
		rows = append(rows, entity)
	}
	require.NoError(t, stmts.CreateDeployments(t.Context(), rows))
	return rows
}

func TestDeploymentStatements_CreateAndGetByID(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})

		entity := mustNewDeployment(t, projectID, "https://app.acme.com", rel.ID, domain.DeploymentReasonDeploy, nil)
		entity.DeployID = "dpl_test1"
		entity.Metadata.Message = new("hotfix for the login outage")
		entity.Metadata.DeployedBy = new("user_1")
		entity.Metadata.DeployedByType = new(domain.EventActorTypeHuman)
		require.NoError(t, d.stmts.CreateDeployments(t.Context(), []*domain.Deployment{entity}))

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
		assert.Equal(t, "dpl_test1", got.DeployID)
		assert.Equal(t, "https://app.acme.com", got.Origin)
		assert.Equal(t, rel.ID, got.ReleaseID)
		assert.Equal(t, domain.DeploymentReasonDeploy, got.Metadata.Reason)
		assert.Nil(t, got.Metadata.RollbackOf)
		assert.Equal(t, "hotfix for the login outage", *got.Metadata.Message)
		assert.Equal(t, "user_1", *got.Metadata.DeployedBy)
		assert.Equal(t, domain.EventActorTypeHuman, *got.Metadata.DeployedByType)
		assert.Equal(t, entity.DeployedAt, got.DeployedAt)
	})
}

// A deployment with no user identity behind it — a project secret used from
// CI — carries nil actor fields, which has to survive the round trip rather
// than coming back as empty strings. The project default has an empty
// origin, which has to survive too.
func TestDeploymentStatements_NilActorAndDefaultOriginRoundTrip(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})

		entity := createDeploy(t, d.stmts, projectID, rel.ID, "")[0]

		got, err := d.stmts.GetDeploymentByID(t.Context(), projectID, entity.ID)
		require.NoError(t, err)
		assert.Empty(t, got.Origin)
		assert.Nil(t, got.Metadata.DeployedBy)
		assert.Nil(t, got.Metadata.DeployedByType)
		assert.Nil(t, got.Metadata.RollbackOf)
		assert.Nil(t, got.Metadata.Message)
	})
}

// One deploy over several targets is one row per target sharing a deploy id
// and one stamp; the history of each target is its own.
func TestDeploymentStatements_FanOutSharesDeployIDAndStamp(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})

		rows := createDeploy(t, d.stmts, projectID, rel.ID, "", "https://app.acme.com", "https://www.acme.com")
		require.Len(t, rows, 3)
		for _, row := range rows[1:] {
			assert.Equal(t, rows[0].DeployID, row.DeployID)
			assert.Equal(t, rows[0].DeployedAt, row.DeployedAt)
			assert.NotEqual(t, rows[0].ID, row.ID)
		}

		byDeploy, err := d.stmts.ListDeployments(unfilteredListCtx(t), deployment.ListOptions(projectID, nil, &rows[0].DeployID, 10))
		require.NoError(t, err)
		assert.Len(t, byDeploy.Items, 3)

		app := "https://app.acme.com"
		byOrigin, err := d.stmts.ListDeployments(unfilteredListCtx(t), deployment.ListOptions(projectID, &app, nil, 10))
		require.NoError(t, err)
		require.Len(t, byOrigin.Items, 1)
		assert.Equal(t, app, byOrigin.Items[0].Origin)
	})
}

// What a target serves is its newest row. Rollback is another append, with
// the deploy it reversed on the record.
func TestDeploymentStatements_NewestPerOriginAndRollback(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)
		relA := createRelease(t, d.stmts, projectID, "000a", domain.ReleaseMetadata{})
		relB := createRelease(t, d.stmts, projectID, "000b", domain.ReleaseMetadata{})
		const app = "https://app.acme.com"

		first := createDeploy(t, d.stmts, projectID, relA.ID, "", app)
		second := createDeploy(t, d.stmts, projectID, relB.ID, "", app)

		newest, err := d.stmts.NewestDeployment(t.Context(), projectID, app)
		require.NoError(t, err)
		assert.Equal(t, relB.ID, newest.ReleaseID)
		assert.Equal(t, second[0].DeployID, newest.DeployID)

		ofA, err := d.stmts.NewestDeploymentOfRelease(t.Context(), projectID, app, relA.ID)
		require.NoError(t, err)
		assert.Equal(t, first[1].ID, ofA.ID)

		_, err = d.stmts.NewestDeployment(t.Context(), projectID, "https://nothing.acme.com")
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		_, err = d.stmts.NewestDeploymentOfRelease(t.Context(), projectID, "https://nothing.acme.com", relA.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		rollback := mustNewDeployment(t, projectID, app, relA.ID, domain.DeploymentReasonRollback, &second[0].DeployID)
		rollback.DeployID = "dpl_rollback"
		require.NoError(t, d.stmts.CreateDeployments(t.Context(), []*domain.Deployment{rollback}))

		newest, err = d.stmts.NewestDeployment(t.Context(), projectID, app)
		require.NoError(t, err)
		assert.Equal(t, relA.ID, newest.ReleaseID)
		assert.Equal(t, domain.DeploymentReasonRollback, newest.Metadata.Reason)
		require.NotNil(t, newest.Metadata.RollbackOf)
		assert.Equal(t, second[0].DeployID, *newest.Metadata.RollbackOf)

		// The default was not rolled back and still serves relB.
		live, err := d.stmts.ListLiveDeployments(t.Context(), projectID)
		require.NoError(t, err)
		require.Len(t, live, 2)
		assert.Equal(t, "", live[0].Origin)
		assert.Equal(t, relB.ID, live[0].ReleaseID)
		assert.Equal(t, app, live[1].Origin)
		assert.Equal(t, relA.ID, live[1].ReleaseID)

		// Every row survived: the log is append-only.
		history, err := d.stmts.ListDeployments(unfilteredListCtx(t), deployment.ListOptions(projectID, nil, nil, 10))
		require.NoError(t, err)
		assert.Len(t, history.Items, 5)
		assert.Equal(t, newest.ID, history.Items[0].ID)
	})
}

func TestDeploymentStatements_UnknownReleaseIsForeignKeyError(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)

		entity := mustNewDeployment(t, projectID, "", "rel_does_not_exist", domain.DeploymentReasonDeploy, nil)
		entity.DeployID = "dpl_x"
		err := d.stmts.CreateDeployments(t.Context(), []*domain.Deployment{entity})
		assert.ErrorIs(t, err, new(database.ForeignKeyError))

		_, err = d.stmts.NewestDeployment(t.Context(), projectID, "")
		assert.ErrorIs(t, err, new(database.NoRowFoundError), "the refused insert wrote nothing")
	})
}

func TestDeploymentStatements_LockProject(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)
		err := d.pool.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
			if err := tx.Statements().LockProject(ctx, projectID); err != nil {
				return err
			}
			return tx.Statements().LockProject(ctx, projectID+"-missing")
		})
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
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
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})

		rows := createDeploy(t, d.stmts, projectID, rel.ID, "", "https://app.acme.com")

		// Unknown ids are simply absent, not an error.
		got, err := d.stmts.GetDeploymentsByIDs(t.Context(), projectID,
			[]string{rows[0].ID, rows[1].ID, "dep_does_not_exist"})
		require.NoError(t, err)
		gotIDs := make([]string, 0, len(got))
		for _, entity := range got {
			gotIDs = append(gotIDs, entity.ID)
		}
		assert.ElementsMatch(t, []string{rows[0].ID, rows[1].ID}, gotIDs)

		empty, err := d.stmts.GetDeploymentsByIDs(t.Context(), projectID, nil)
		require.NoError(t, err)
		assert.Empty(t, empty)
	})
}

// Deleting the project cascades releases and deployments away together. The
// release reference is NO ACTION, so the cascade has to reach both in one
// statement for this to pass.
func TestDeploymentStatements_ProjectDeleteCascades(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := "proj-dep-del-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateProject(t.Context(), newTestProject(projectID)))
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		entity := createDeploy(t, d.stmts, projectID, rel.ID, "")[0]
		require.NoError(t, d.stmts.CreateDeploymentVariables(t.Context(), []*domain.DeploymentVariable{
			{ProjectID: projectID, DeploymentID: entity.ID, Name: "X", Value: "1"},
		}))

		_, err := d.stmts.DeleteProjectByID(t.Context(), projectID)
		require.NoError(t, err)

		_, err = d.stmts.GetDeploymentByID(t.Context(), projectID, entity.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		frozen, err := d.stmts.GetDeploymentVariables(t.Context(), projectID, entity.ID)
		require.NoError(t, err)
		assert.Empty(t, frozen)
	})
}

// The values a deployment froze are its own: editing the store afterwards
// reaches none of them, and a second deployment of the same release may hold
// different ones.
func TestDeploymentStatements_FrozenVariables(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		first := createDeploy(t, d.stmts, projectID, rel.ID, "")[0]
		second := createDeploy(t, d.stmts, projectID, rel.ID, "")[0]

		require.NoError(t, d.stmts.CreateDeploymentVariables(t.Context(), []*domain.DeploymentVariable{
			{ProjectID: projectID, DeploymentID: first.ID, Name: "SUPPORT_EMAIL", Value: "help@acme.com"},
			{ProjectID: projectID, DeploymentID: first.ID, Name: "GOOGLE_CLIENT_SECRET", Value: "cipher-1", IsSecret: true},
		}))
		require.NoError(t, d.stmts.CreateDeploymentVariables(t.Context(), []*domain.DeploymentVariable{
			{ProjectID: projectID, DeploymentID: second.ID, Name: "SUPPORT_EMAIL", Value: "support@acme.com"},
		}))

		frozen, err := d.stmts.GetDeploymentVariables(t.Context(), projectID, first.ID)
		require.NoError(t, err)
		require.Len(t, frozen, 2)
		assert.Equal(t, "GOOGLE_CLIENT_SECRET", frozen[0].Name)
		assert.Equal(t, "cipher-1", frozen[0].Value)
		assert.True(t, frozen[0].IsSecret)
		assert.Equal(t, "SUPPORT_EMAIL", frozen[1].Name)
		assert.Equal(t, "help@acme.com", frozen[1].Value)

		frozen, err = d.stmts.GetDeploymentVariables(t.Context(), projectID, second.ID)
		require.NoError(t, err)
		require.Len(t, frozen, 1)
		assert.Equal(t, "support@acme.com", frozen[0].Value)

		// The same name on the same deployment twice is a caller bug the key
		// refuses.
		err = d.stmts.CreateDeploymentVariables(t.Context(), []*domain.DeploymentVariable{
			{ProjectID: projectID, DeploymentID: second.ID, Name: "SUPPORT_EMAIL", Value: "again"},
		})
		assert.ErrorIs(t, err, new(database.UniqueError))

		// A deployment that is not there froze nothing.
		frozen, err = d.stmts.GetDeploymentVariables(t.Context(), projectID, "dep_does_not_exist")
		require.NoError(t, err)
		assert.Empty(t, frozen)
	})
}

func TestDeploymentStatements_ListNewestFirst(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)
		relA := createRelease(t, d.stmts, projectID, "000a", domain.ReleaseMetadata{})
		relB := createRelease(t, d.stmts, projectID, "000b", domain.ReleaseMetadata{})
		const app = "https://app.acme.com"
		const preview = "https://acme-git-sso-acmeinc.vercel.app"

		first := createDeploy(t, d.stmts, projectID, relA.ID, app)[0]
		onPreview := createDeploy(t, d.stmts, projectID, relA.ID, preview)[0]
		second := createDeploy(t, d.stmts, projectID, relB.ID, app)[0]

		// Filtered to one target: its history, newest first, the preview absent.
		appOrigin := app
		result, err := d.stmts.ListDeployments(unfilteredListCtx(t), deployment.ListOptions(projectID, &appOrigin, nil, 10))
		require.NoError(t, err)
		require.Len(t, result.Items, 2)
		assert.Equal(t, second.ID, result.Items[0].ID)
		assert.Equal(t, first.ID, result.Items[1].ID)

		// Unfiltered: every target of the project, newest first.
		result, err = d.stmts.ListDeployments(unfilteredListCtx(t), deployment.ListOptions(projectID, nil, nil, 10))
		require.NoError(t, err)
		require.Len(t, result.Items, 3)
		assert.Equal(t, second.ID, result.Items[0].ID)
		assert.Equal(t, onPreview.ID, result.Items[1].ID)
		assert.Equal(t, first.ID, result.Items[2].ID)
	})
}

// Two deploys to one target in one instant share deployed_at, and id breaks
// the tie the same way everywhere: the live view and the newest read agree.
func TestDeploymentStatements_TieBreaksOnID(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)
		relA := createRelease(t, d.stmts, projectID, "000a", domain.ReleaseMetadata{})
		relB := createRelease(t, d.stmts, projectID, "000b", domain.ReleaseMetadata{})

		a := mustNewDeployment(t, projectID, "", relA.ID, domain.DeploymentReasonDeploy, nil)
		a.DeployID = "dpl_tie"
		b := mustNewDeployment(t, projectID, "", relB.ID, domain.DeploymentReasonDeploy, nil)
		b.DeployID = "dpl_tie"
		// One call stamps both rows alike, which is the tie.
		require.NoError(t, d.stmts.CreateDeployments(t.Context(), []*domain.Deployment{a, b}))
		require.Equal(t, a.DeployedAt, b.DeployedAt)

		want := a
		if b.ID > a.ID {
			want = b
		}
		newest, err := d.stmts.NewestDeployment(t.Context(), projectID, "")
		require.NoError(t, err)
		assert.Equal(t, want.ID, newest.ID)
		live, err := d.stmts.ListLiveDeployments(t.Context(), projectID)
		require.NoError(t, err)
		require.Len(t, live, 1)
		assert.Equal(t, want.ID, live[0].ID)
	})
}

func errorsAsForeignKeyDeployment(err error) bool {
	var target *database.ForeignKeyError
	return errors.As(err, &target)
}
