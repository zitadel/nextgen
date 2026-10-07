//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func ensurePreviewProject(t *testing.T, stmts service.AllStatements) string {
	t.Helper()
	projectID := "proj-preview-" + uniqueSuffix(t)
	require.NoError(t, stmts.CreateProject(t.Context(), newTestProject(projectID)))
	t.Cleanup(func() { _, _ = stmts.DeleteProjectByID(context.Background(), projectID) })
	return projectID
}

func TestPreviewStatements_UpsertRenewsAndKeepsCreatedAt(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensurePreviewProject(t, d.stmts)
		const url = "https://acme-git-sso-acmeinc.vercel.app"
		// Second precision: sqlite stores nanos, the others microseconds, and
		// the test compares what comes back with what went in.
		first := time.Now().Add(7 * 24 * time.Hour).Truncate(time.Second)

		entity := &domain.Preview{ProjectID: projectID, Origin: url, ExpiresAt: first}
		require.NoError(t, d.stmts.UpsertPreview(t.Context(), entity))
		assert.False(t, entity.CreatedAt.IsZero())
		assert.WithinDuration(t, time.Now(), entity.CreatedAt, 5*time.Second)
		createdAt := entity.CreatedAt

		got, err := d.stmts.GetPreview(t.Context(), projectID, url)
		require.NoError(t, err)
		assert.Equal(t, first.UTC(), got.ExpiresAt)
		assert.Equal(t, createdAt, got.CreatedAt)
		assert.False(t, got.Expired(time.Now()))

		renewed := &domain.Preview{ProjectID: projectID, Origin: url, ExpiresAt: first.Add(24 * time.Hour)}
		require.NoError(t, d.stmts.UpsertPreview(t.Context(), renewed))
		assert.Equal(t, createdAt, renewed.CreatedAt, "renewing keeps the original creation stamp")

		got, err = d.stmts.GetPreview(t.Context(), projectID, url)
		require.NoError(t, err)
		assert.Equal(t, first.Add(24*time.Hour).UTC(), got.ExpiresAt)

		listed, err := d.stmts.ListPreviews(t.Context(), projectID)
		require.NoError(t, err)
		require.Len(t, listed, 1, "a renewal is not a second row")
	})
}

func TestPreviewStatements_ListIsProjectScopedAndOrdered(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensurePreviewProject(t, d.stmts)
		otherID := ensurePreviewProject(t, d.stmts)
		expires := time.Now().Add(time.Hour)
		for _, url := range []string{"https://b.acme.com", "https://a.acme.com"} {
			require.NoError(t, d.stmts.UpsertPreview(t.Context(), &domain.Preview{ProjectID: projectID, Origin: url, ExpiresAt: expires}))
		}
		require.NoError(t, d.stmts.UpsertPreview(t.Context(), &domain.Preview{ProjectID: otherID, Origin: "https://c.acme.com", ExpiresAt: expires}))

		listed, err := d.stmts.ListPreviews(t.Context(), projectID)
		require.NoError(t, err)
		require.Len(t, listed, 2)
		assert.Equal(t, "https://a.acme.com", listed[0].Origin)
		assert.Equal(t, "https://b.acme.com", listed[1].Origin)

		_, err = d.stmts.GetPreview(t.Context(), projectID, "https://c.acme.com")
		assert.ErrorIs(t, err, new(database.NoRowFoundError), "another project's row is not visible")
	})
}

func TestPreviewStatements_DeleteAndSweep(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensurePreviewProject(t, d.stmts)
		now := time.Now()
		live := &domain.Preview{ProjectID: projectID, Origin: "https://live.acme.com", ExpiresAt: now.Add(time.Hour)}
		stale := &domain.Preview{ProjectID: projectID, Origin: "https://stale.acme.com", ExpiresAt: now.Add(-time.Hour)}
		require.NoError(t, d.stmts.UpsertPreview(t.Context(), live))
		require.NoError(t, d.stmts.UpsertPreview(t.Context(), stale))

		got, err := d.stmts.GetPreview(t.Context(), projectID, stale.Origin)
		require.NoError(t, err, "an expired row is still read; admission checks the expiry")
		assert.True(t, got.Expired(now))

		// The sweep only takes what has expired, and says how many.
		swept, err := d.stmts.DeleteExpiredPreviews(t.Context(), now)
		require.NoError(t, err)
		assert.GreaterOrEqual(t, swept, int64(1))
		_, err = d.stmts.GetPreview(t.Context(), projectID, stale.Origin)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		_, err = d.stmts.GetPreview(t.Context(), projectID, live.Origin)
		require.NoError(t, err)

		require.NoError(t, d.stmts.DeletePreview(t.Context(), projectID, live.Origin))
		err = d.stmts.DeletePreview(t.Context(), projectID, live.Origin)
		assert.ErrorIs(t, err, new(database.NoRowFoundError), "retiring what is not there is reported")
	})
}

func TestPreviewStatements_ProjectDeleteCascades(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := "proj-preview-del-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateProject(t.Context(), newTestProject(projectID)))
		require.NoError(t, d.stmts.UpsertPreview(t.Context(), &domain.Preview{ProjectID: projectID, Origin: "https://x.acme.com", ExpiresAt: time.Now().Add(time.Hour)}))

		_, err := d.stmts.DeleteProjectByID(t.Context(), projectID)
		require.NoError(t, err)

		listed, err := d.stmts.ListPreviews(t.Context(), projectID)
		require.NoError(t, err)
		assert.Empty(t, listed)
	})
}
