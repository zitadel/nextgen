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

func mustNewDeployment(t *testing.T, projectID string, origins []string, releaseID string, reason domain.DeploymentReason, rollbackOf *string) *domain.Deployment {
	t.Helper()
	entity, err := domain.NewDeployment(projectID, origins, releaseID, domain.DeploymentMetadata{
		Reason:     reason,
		RollbackOf: rollbackOf,
	})
	require.NoError(t, err)
	return entity
}

// createDeploy writes one deployment of releaseID to every origin, the way
// the service does: lock, insert, commit.
func createDeploy(t *testing.T, stmts service.AllStatements, projectID, releaseID string, origins ...string) *domain.Deployment {
	t.Helper()
	entity := mustNewDeployment(t, projectID, origins, releaseID, domain.DeploymentReasonDeploy, nil)
	require.NoError(t, stmts.CreateDeployment(t.Context(), entity))
	return entity
}

func TestDeploymentStatements_CreateAndGetByID(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})

		entity := mustNewDeployment(t, projectID, []string{"https://www.acme.com", "https://app.acme.com"}, rel.ID, domain.DeploymentReasonDeploy, nil)
		entity.Metadata.Message = new("hotfix for the login outage")
		entity.Metadata.DeployedBy = new("user_1")
		entity.Metadata.DeployedByType = new(domain.EventActorTypeHuman)
		require.NoError(t, d.stmts.CreateDeployment(t.Context(), entity))

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
		assert.Equal(t, []string{"https://app.acme.com", "https://www.acme.com"}, got.Origins(), "targets read origin ASC")
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

		entity := createDeploy(t, d.stmts, projectID, rel.ID, "")

		got, err := d.stmts.GetDeploymentByID(t.Context(), projectID, entity.ID)
		require.NoError(t, err)
		assert.Equal(t, []string{""}, got.Origins())
		assert.Nil(t, got.Metadata.DeployedBy)
		assert.Nil(t, got.Metadata.DeployedByType)
		assert.Nil(t, got.Metadata.RollbackOf)
		assert.Nil(t, got.Metadata.Message)
	})
}

// One deployment over several targets is one operation; the history of each
// target is its own.
func TestDeploymentStatements_FanOutIsOneOperation(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})

		entity := createDeploy(t, d.stmts, projectID, rel.ID, "", "https://app.acme.com", "https://www.acme.com")
		require.Len(t, entity.Targets, 3)

		all, err := d.stmts.ListDeployments(unfilteredListCtx(t), deployment.ListOptions(projectID, nil, 10))
		require.NoError(t, err)
		require.Len(t, all.Items, 1)
		assert.Equal(t, []string{"", "https://app.acme.com", "https://www.acme.com"}, all.Items[0].Origins())

		app := "https://app.acme.com"
		byOrigin, err := d.stmts.ListDeployments(unfilteredListCtx(t), deployment.ListOptions(projectID, &app, 10))
		require.NoError(t, err)
		require.Len(t, byOrigin.Items, 1)
		assert.Equal(t, entity.ID, byOrigin.Items[0].ID)

		nothing := "https://nothing.acme.com"
		none, err := d.stmts.ListDeployments(unfilteredListCtx(t), deployment.ListOptions(projectID, &nothing, 10))
		require.NoError(t, err)
		assert.Empty(t, none.Items)
	})
}

// What a target serves is the newest deployment naming it. Rollback is
// another append, with the deployment it reversed on the record.
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
		assert.Equal(t, second.ID, newest.ID)
		assert.Equal(t, []string{"", app}, newest.Origins(), "the operation carries every target it moved")

		ofA, err := d.stmts.NewestDeploymentOfRelease(t.Context(), projectID, app, relA.ID)
		require.NoError(t, err)
		assert.Equal(t, first.ID, ofA.ID)

		_, err = d.stmts.NewestDeployment(t.Context(), projectID, "https://nothing.acme.com")
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		_, err = d.stmts.NewestDeploymentOfRelease(t.Context(), projectID, "https://nothing.acme.com", relA.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		rollback := mustNewDeployment(t, projectID, []string{app}, relA.ID, domain.DeploymentReasonRollback, &second.ID)
		require.NoError(t, d.stmts.CreateDeployment(t.Context(), rollback))

		newest, err = d.stmts.NewestDeployment(t.Context(), projectID, app)
		require.NoError(t, err)
		assert.Equal(t, relA.ID, newest.ReleaseID)
		assert.Equal(t, domain.DeploymentReasonRollback, newest.Metadata.Reason)
		require.NotNil(t, newest.Metadata.RollbackOf)
		assert.Equal(t, second.ID, *newest.Metadata.RollbackOf)

		// The default was not rolled back and still serves relB from the
		// second deployment, which the live view lists with that one target.
		live, err := d.stmts.ListLiveDeployments(t.Context(), projectID)
		require.NoError(t, err)
		require.Len(t, live, 2)
		assert.Equal(t, rollback.ID, live[0].ID)
		assert.Equal(t, []string{app}, live[0].Origins())
		assert.Equal(t, second.ID, live[1].ID)
		assert.Equal(t, []string{""}, live[1].Origins())

		// Every deployment survived: the log is append-only.
		history, err := d.stmts.ListDeployments(unfilteredListCtx(t), deployment.ListOptions(projectID, nil, 10))
		require.NoError(t, err)
		assert.Len(t, history.Items, 3)
		assert.Equal(t, rollback.ID, history.Items[0].ID)
	})
}

func TestDeploymentStatements_UnknownReleaseIsForeignKeyError(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)

		entity := mustNewDeployment(t, projectID, []string{""}, "rel_does_not_exist", domain.DeploymentReasonDeploy, nil)
		err := d.stmts.CreateDeployment(t.Context(), entity)
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

		first := createDeploy(t, d.stmts, projectID, rel.ID, "")
		second := createDeploy(t, d.stmts, projectID, rel.ID, "https://app.acme.com")

		// Unknown ids are simply absent, not an error.
		got, err := d.stmts.GetDeploymentsByIDs(t.Context(), projectID,
			[]string{first.ID, second.ID, "dep_does_not_exist"})
		require.NoError(t, err)
		gotIDs := make([]string, 0, len(got))
		for _, entity := range got {
			gotIDs = append(gotIDs, entity.ID)
			assert.Len(t, entity.Targets, 1)
		}
		assert.ElementsMatch(t, []string{first.ID, second.ID}, gotIDs)

		empty, err := d.stmts.GetDeploymentsByIDs(t.Context(), projectID, nil)
		require.NoError(t, err)
		assert.Empty(t, empty)
	})
}

// Deleting the project cascades releases, deployments and their targets away
// together. The release reference is NO ACTION, so the cascade has to reach
// both in one statement for this to pass.
func TestDeploymentStatements_ProjectDeleteCascades(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := "proj-dep-del-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateProject(t.Context(), newTestProject(projectID)))
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		entity := createDeploy(t, d.stmts, projectID, rel.ID, "")
		require.NoError(t, d.stmts.CreateDeploymentVariables(t.Context(), []*domain.DeploymentVariable{
			{ProjectID: projectID, DeploymentID: entity.ID, Name: "X", Value: "1"},
		}))

		_, err := d.stmts.DeleteProjectByID(t.Context(), projectID)
		require.NoError(t, err)

		_, err = d.stmts.GetDeploymentByID(t.Context(), projectID, entity.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		_, err = d.stmts.NewestDeployment(t.Context(), projectID, "")
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
		first := createDeploy(t, d.stmts, projectID, rel.ID, "")
		second := createDeploy(t, d.stmts, projectID, rel.ID, "")

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

		first := createDeploy(t, d.stmts, projectID, relA.ID, app)
		onPreview := createDeploy(t, d.stmts, projectID, relA.ID, preview)
		second := createDeploy(t, d.stmts, projectID, relB.ID, app)

		// Filtered to one target: its history, newest first, the preview absent.
		appOrigin := app
		result, err := d.stmts.ListDeployments(unfilteredListCtx(t), deployment.ListOptions(projectID, &appOrigin, 10))
		require.NoError(t, err)
		require.Len(t, result.Items, 2)
		assert.Equal(t, second.ID, result.Items[0].ID)
		assert.Equal(t, first.ID, result.Items[1].ID)

		// Unfiltered: every deployment of the project, newest first.
		result, err = d.stmts.ListDeployments(unfilteredListCtx(t), deployment.ListOptions(projectID, nil, 10))
		require.NoError(t, err)
		require.Len(t, result.Items, 3)
		assert.Equal(t, second.ID, result.Items[0].ID)
		assert.Equal(t, onPreview.ID, result.Items[1].ID)
		assert.Equal(t, first.ID, result.Items[2].ID)

		// Paged by keyset across the origin filter.
		page, err := d.stmts.ListDeployments(unfilteredListCtx(t), deployment.ListOptions(projectID, &appOrigin, 1))
		require.NoError(t, err)
		require.Len(t, page.Items, 1)
		assert.Equal(t, second.ID, page.Items[0].ID)
		require.NotEmpty(t, page.NextCursor)
		opts := deployment.ListOptions(projectID, &appOrigin, 1)
		opts.Pagination.Cursor = page.NextCursor
		page, err = d.stmts.ListDeployments(unfilteredListCtx(t), opts)
		require.NoError(t, err)
		require.Len(t, page.Items, 1)
		assert.Equal(t, first.ID, page.Items[0].ID)
	})
}

// The newest read and the live view agree on what a target serves, with the
// id breaking a deployed_at tie the same way in both.
func TestDeploymentStatements_TieBreaksOnID(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureDeploymentProject(t, d.stmts)
		relA := createRelease(t, d.stmts, projectID, "000a", domain.ReleaseMetadata{})
		relB := createRelease(t, d.stmts, projectID, "000b", domain.ReleaseMetadata{})

		a := createDeploy(t, d.stmts, projectID, relA.ID, "")
		b := createDeploy(t, d.stmts, projectID, relB.ID, "")

		// Stamped apart, the later one wins; stamped alike, the greater id.
		want := b
		if a.DeployedAt.After(b.DeployedAt) || (a.DeployedAt.Equal(b.DeployedAt) && a.ID > b.ID) {
			want = a
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
