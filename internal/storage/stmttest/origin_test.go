//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestOriginsRoundTrip(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		project := newTestProject(uniqueProjectID(t))
		project.Origins = []domain.Origin{
			{Pattern: "https://app.example.com", Kind: domain.OriginKindPrimary},
			{Pattern: "https://*-acme.vercel.app", Kind: domain.OriginKindPreview},
		}
		require.NoError(t, d.stmts.CreateProject(t.Context(), project))
		t.Cleanup(func() { _, _ = d.stmts.DeleteProjectByID(context.Background(), project.ID) })

		got, err := d.stmts.GetProjectByID(t.Context(), project.ID)
		require.NoError(t, err)
		// Create order must survive hydrate: list is created_at then pattern.
		assert.Equal(t, project.Origins, got.Origins)

		listed, err := d.stmts.ListOriginsByProjectID(t.Context(), project.ID)
		require.NoError(t, err)
		assert.Equal(t, project.Origins, listed)
	})
}

func TestOriginsInsertIdempotentAndDelete(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		project := newTestProject(uniqueProjectID(t))
		require.NoError(t, d.stmts.CreateProject(t.Context(), project))
		t.Cleanup(func() { _, _ = d.stmts.DeleteProjectByID(context.Background(), project.ID) })

		origin := domain.Origin{Pattern: "https://preview.example.com", Kind: domain.OriginKindPreview}
		inserted, err := d.stmts.InsertOrigin(t.Context(), project.ID, origin)
		require.NoError(t, err)
		assert.True(t, inserted)

		again, err := d.stmts.InsertOrigin(t.Context(), project.ID, origin)
		require.NoError(t, err)
		assert.False(t, again)

		got, err := d.stmts.GetOriginByPattern(t.Context(), project.ID, origin.Pattern)
		require.NoError(t, err)
		assert.Equal(t, origin, *got)

		deleted, removed, err := d.stmts.DeleteOriginByPattern(t.Context(), project.ID, origin.Pattern)
		require.NoError(t, err)
		assert.True(t, deleted)
		require.NotNil(t, removed)
		assert.Equal(t, origin, *removed)

		deleted, removed, err = d.stmts.DeleteOriginByPattern(t.Context(), project.ID, origin.Pattern)
		require.NoError(t, err)
		assert.False(t, deleted)
		assert.Nil(t, removed)

		_, err = d.stmts.GetOriginByPattern(t.Context(), project.ID, origin.Pattern)
		require.Error(t, err)
		var noRow *database.NoRowFoundError
		assert.ErrorAs(t, err, &noRow)
	})
}

func TestOriginsProjectDeleteCascades(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		project := newTestProject(uniqueProjectID(t))
		require.NoError(t, d.stmts.CreateProject(t.Context(), project))
		_, err := d.stmts.InsertOrigin(t.Context(), project.ID, domain.Origin{
			Pattern: "https://cascade.example.com",
			Kind:    domain.OriginKindPrimary,
		})
		require.NoError(t, err)

		changed, err := d.stmts.DeleteProjectByID(t.Context(), project.ID)
		require.NoError(t, err)
		assert.True(t, changed)

		origins, err := d.stmts.ListOriginsByProjectID(t.Context(), project.ID)
		require.NoError(t, err)
		assert.Empty(t, origins)
	})
}
