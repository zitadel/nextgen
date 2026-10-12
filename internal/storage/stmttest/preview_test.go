//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/preview"
)

func previewOrigins(t *testing.T, stmts service.AllStatements, opts *database.ListOptions[domain.PreviewField]) []string {
	t.Helper()
	result, err := stmts.ListPreviews(t.Context(), opts)
	require.NoError(t, err)
	origins := make([]string, len(result.Items))
	for i, item := range result.Items {
		origins[i] = item.Origin
	}
	return origins
}

// A deploy to preview URLs creates their previews, expiring ttl after the
// deploy, and a later deploy renews them while keeping when each was created.
func TestPreviewStatements_DeployCreatesAndRenews(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		relA := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		relB := createRelease(t, d.stmts, projectID, "0002", domain.ReleaseMetadata{})

		first, _ := deploy(t, d.stmts, projectID, relA.ID, []string{gitOrigin}, previewDeploy(time.Hour))
		created, err := d.stmts.GetPreview(t.Context(), projectID, gitOrigin)
		require.NoError(t, err)
		assert.True(t, created.CreatedAt.Equal(first.DeployedAt))
		assert.True(t, created.ExpiresAt.Equal(first.DeployedAt.Add(time.Hour)))

		second, _ := deploy(t, d.stmts, projectID, relB.ID, []string{gitOrigin, shaOrigin}, previewDeploy(168*time.Hour))
		renewed, err := d.stmts.GetPreview(t.Context(), projectID, gitOrigin)
		require.NoError(t, err)
		assert.True(t, renewed.CreatedAt.Equal(first.DeployedAt), "a renewal keeps created_at")
		assert.True(t, renewed.ExpiresAt.Equal(second.DeployedAt.Add(168*time.Hour)))

		fresh, err := d.stmts.GetPreview(t.Context(), projectID, shaOrigin)
		require.NoError(t, err)
		assert.True(t, fresh.CreatedAt.Equal(second.DeployedAt))

		// A primary deploy never creates a preview.
		deploy(t, d.stmts, projectID, relA.ID, []string{appOrigin}, deployArgs{})
		_, err = d.stmts.GetPreview(t.Context(), projectID, appOrigin)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// A deploy to preview URLs has to say how long they live.
func TestPreviewStatements_DeployNeedsTTL(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})

		_, err := tryDeploy(t, d.stmts, projectID, rel.ID, []string{gitOrigin}, previewDeploy(0))
		de, ok := errors.AsType[domain.Error](err)
		require.True(t, ok, "expected a domain error, got %T: %v", err, err)
		assert.Equal(t, domain.ErrDeploymentInvalid(nil, nil).Code, de.Code)
	})
}

// The live list holds the previews that have not expired, newest first; the
// expired list holds the rest, the ones to sweep.
func TestPreviewStatements_LiveAndExpired(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		otherProject := ensureReleaseProject(t, d.stmts)
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		otherRel := createRelease(t, d.stmts, otherProject, "0001", domain.ReleaseMetadata{})

		short, _ := deploy(t, d.stmts, projectID, rel.ID, []string{gitOrigin}, previewDeploy(time.Minute))
		deploy(t, d.stmts, projectID, rel.ID, []string{shaOrigin}, previewDeploy(time.Hour))
		deploy(t, d.stmts, otherProject, otherRel.ID, []string{gitOrigin}, previewDeploy(time.Minute))

		now := time.Now()
		assert.Equal(t, []string{shaOrigin, gitOrigin}, previewOrigins(t, d.stmts, preview.LiveListOptions(projectID, now, 50)))
		assert.Empty(t, previewOrigins(t, d.stmts, preview.ExpiredListOptions(projectID, now, 50)))

		// At the instant of expiry a preview no longer admits its URL.
		expiry := short.DeployedAt.Add(time.Minute)
		assert.Equal(t, []string{shaOrigin}, previewOrigins(t, d.stmts, preview.LiveListOptions(projectID, expiry, 50)))
		assert.Equal(t, []string{gitOrigin}, previewOrigins(t, d.stmts, preview.ExpiredListOptions(projectID, expiry, 50)))

		later := now.Add(2 * time.Hour)
		assert.Empty(t, previewOrigins(t, d.stmts, preview.LiveListOptions(projectID, later, 50)))
		assert.Equal(t, []string{gitOrigin, shaOrigin}, previewOrigins(t, d.stmts, preview.ExpiredListOptions(projectID, later, 50)))
	})
}

// Removing a preview is idempotent and leaves the deployments to its URL.
func TestPreviewStatements_Delete(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		dep, _ := deploy(t, d.stmts, projectID, rel.ID, []string{gitOrigin}, previewDeploy(time.Hour))

		deleted, err := d.stmts.DeletePreview(t.Context(), projectID, gitOrigin)
		require.NoError(t, err)
		assert.True(t, deleted)
		deleted, err = d.stmts.DeletePreview(t.Context(), projectID, gitOrigin)
		require.NoError(t, err)
		assert.False(t, deleted)

		_, err = d.stmts.GetPreview(t.Context(), projectID, gitOrigin)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		assert.Equal(t, []string{dep.ID}, deploymentIDs(history(t, d.stmts, projectID, gitOrigin)))
	})
}

// The sweep deletes a preview only if it has expired, so a renewal that
// landed after the sweep listed it survives.
func TestPreviewStatements_SweepSparesARenewal(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		relB := createRelease(t, d.stmts, projectID, "0002", domain.ReleaseMetadata{})
		first, _ := deploy(t, d.stmts, projectID, rel.ID, []string{gitOrigin}, previewDeploy(time.Minute))

		sweepAt := first.DeployedAt.Add(2 * time.Minute)
		require.Equal(t, []string{gitOrigin}, previewOrigins(t, d.stmts, preview.ExpiredListOptions(projectID, sweepAt, 50)))

		// The renewal lands between the sweep's list and its delete.
		deploy(t, d.stmts, projectID, relB.ID, []string{gitOrigin}, previewDeploy(time.Hour))

		swept, err := d.stmts.DeleteExpiredPreview(t.Context(), projectID, gitOrigin, sweepAt)
		require.NoError(t, err)
		assert.False(t, swept)
		_, err = d.stmts.GetPreview(t.Context(), projectID, gitOrigin)
		require.NoError(t, err)

		swept, err = d.stmts.DeleteExpiredPreview(t.Context(), projectID, gitOrigin, time.Now().Add(2*time.Hour))
		require.NoError(t, err)
		assert.True(t, swept)
	})
}

// A release an origin still serves cannot be revoked: the refusal names each
// origin and the deployment it serves. Once nothing serves it — another
// release deployed over it, its preview expired — the revoke goes through.
func TestReleaseStatements_RevokeRefusedWhileServed(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		relA := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		relB := createRelease(t, d.stmts, projectID, "0002", domain.ReleaseMetadata{})

		onPrimaries, _ := deploy(t, d.stmts, projectID, relA.ID, []string{appOrigin, wwwOrigin}, deployArgs{})
		onPreview, _ := deploy(t, d.stmts, projectID, relA.ID, []string{gitOrigin}, previewDeploy(time.Hour))

		_, err := d.stmts.RevokeRelease(t.Context(), projectID, relA.ID, time.Now())
		de, ok := errors.AsType[domain.Error](err)
		require.True(t, ok, "expected a domain error, got %T: %v", err, err)
		assert.Equal(t, domain.ErrReleaseInUse(domain.ReleaseInUseDetails{}).Code, de.Code)
		assert.Equal(t, domain.ReleaseInUseDetails{Origins: []domain.ReleaseServedOrigin{
			{Origin: gitOrigin, DeploymentID: onPreview.ID},
			{Origin: appOrigin, DeploymentID: onPrimaries.ID},
			{Origin: wwwOrigin, DeploymentID: onPrimaries.ID},
		}}, de.Details)

		got, err := d.stmts.GetReleaseByID(t.Context(), projectID, relA.ID)
		require.NoError(t, err)
		assert.Nil(t, got.RevokedAt, "a refused revoke writes nothing")

		deploy(t, d.stmts, projectID, relB.ID, []string{appOrigin, wwwOrigin}, deployArgs{})

		// The preview still serves it until it expires.
		_, err = d.stmts.RevokeRelease(t.Context(), projectID, relA.ID, time.Now())
		de, ok = errors.AsType[domain.Error](err)
		require.True(t, ok, "expected a domain error, got %T: %v", err, err)
		assert.Equal(t, domain.ReleaseInUseDetails{Origins: []domain.ReleaseServedOrigin{
			{Origin: gitOrigin, DeploymentID: onPreview.ID},
		}}, de.Details)

		revoked, err := d.stmts.RevokeRelease(t.Context(), projectID, relA.ID, time.Now().Add(2*time.Hour))
		require.NoError(t, err)
		assert.NotNil(t, revoked.RevokedAt)

		// The history that named it stays.
		assert.Len(t, history(t, d.stmts, projectID, appOrigin), 2)
	})
}
