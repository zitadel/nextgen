//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
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

// An upsert creates missing previews and renews existing ones, keeping their
// created_at.
func TestPreviewStatements_UpsertCreatesAndRenews(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		t0 := time.Now().UTC().Truncate(time.Microsecond)

		require.NoError(t, d.stmts.UpsertPreviews(t.Context(), projectID, []string{gitOrigin}, t0.Add(time.Hour), t0))
		created, err := d.stmts.GetPreview(t.Context(), projectID, gitOrigin)
		require.NoError(t, err)
		assert.True(t, created.CreatedAt.Equal(t0))
		assert.True(t, created.ExpiresAt.Equal(t0.Add(time.Hour)))

		t1 := t0.Add(time.Minute)
		require.NoError(t, d.stmts.UpsertPreviews(t.Context(), projectID, []string{gitOrigin, shaOrigin}, t1.Add(168*time.Hour), t1))
		renewed, err := d.stmts.GetPreview(t.Context(), projectID, gitOrigin)
		require.NoError(t, err)
		assert.True(t, renewed.CreatedAt.Equal(t0), "a renewal keeps created_at")
		assert.True(t, renewed.ExpiresAt.Equal(t1.Add(168*time.Hour)))

		fresh, err := d.stmts.GetPreview(t.Context(), projectID, shaOrigin)
		require.NoError(t, err)
		assert.True(t, fresh.CreatedAt.Equal(t1))
	})
}

// The live list holds the previews that have not expired, newest first; the
// expired list holds the ones to sweep.
func TestPreviewStatements_LiveAndExpired(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		otherProject := ensureReleaseProject(t, d.stmts)
		t0 := time.Now().UTC().Truncate(time.Microsecond)

		require.NoError(t, d.stmts.UpsertPreviews(t.Context(), projectID, []string{gitOrigin}, t0.Add(time.Minute), t0))
		require.NoError(t, d.stmts.UpsertPreviews(t.Context(), projectID, []string{shaOrigin}, t0.Add(time.Hour), t0.Add(time.Second)))
		require.NoError(t, d.stmts.UpsertPreviews(t.Context(), otherProject, []string{gitOrigin}, t0.Add(time.Minute), t0))

		assert.Equal(t, []string{shaOrigin, gitOrigin}, previewOrigins(t, d.stmts, preview.LiveListOptions(projectID, t0, 50)))
		assert.Empty(t, previewOrigins(t, d.stmts, preview.ExpiredListOptions(projectID, t0, 50)))

		// At the instant of expiry a preview no longer admits its URL.
		expiry := t0.Add(time.Minute)
		assert.Equal(t, []string{shaOrigin}, previewOrigins(t, d.stmts, preview.LiveListOptions(projectID, expiry, 50)))
		assert.Equal(t, []string{gitOrigin}, previewOrigins(t, d.stmts, preview.ExpiredListOptions(projectID, expiry, 50)))

		later := t0.Add(2 * time.Hour)
		assert.Empty(t, previewOrigins(t, d.stmts, preview.LiveListOptions(projectID, later, 50)))
		assert.Equal(t, []string{gitOrigin, shaOrigin}, previewOrigins(t, d.stmts, preview.ExpiredListOptions(projectID, later, 50)))
	})
}

// Removing a preview is idempotent and leaves the deployments to its URL.
func TestPreviewStatements_Delete(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		rel := createRelease(t, d.stmts, projectID, "0001", domain.ReleaseMetadata{})
		dep := deploy(t, d.stmts, projectID, rel.ID, []string{gitOrigin}, previewDeploy(time.Hour))

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

// The sweep deletes only an expired preview, so a renewal that landed after
// the sweep listed it survives.
func TestPreviewStatements_SweepSparesARenewal(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureReleaseProject(t, d.stmts)
		t0 := time.Now().UTC().Truncate(time.Microsecond)
		require.NoError(t, d.stmts.UpsertPreviews(t.Context(), projectID, []string{gitOrigin}, t0.Add(time.Minute), t0))

		sweepAt := t0.Add(2 * time.Minute)
		require.Equal(t, []string{gitOrigin}, previewOrigins(t, d.stmts, preview.ExpiredListOptions(projectID, sweepAt, 50)))

		require.NoError(t, d.stmts.UpsertPreviews(t.Context(), projectID, []string{gitOrigin}, t0.Add(time.Hour), t0.Add(time.Minute)))

		swept, err := d.stmts.DeleteExpiredPreview(t.Context(), projectID, gitOrigin, sweepAt)
		require.NoError(t, err)
		assert.False(t, swept)

		swept, err = d.stmts.DeleteExpiredPreview(t.Context(), projectID, gitOrigin, t0.Add(2*time.Hour))
		require.NoError(t, err)
		assert.True(t, swept)
	})
}
