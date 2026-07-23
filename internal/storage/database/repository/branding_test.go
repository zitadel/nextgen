//go:build postgres_integration || spanner_integration

package repository_test

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func sampleBranding(projectID, id string) *domain.Branding {
	return &domain.Branding{
		ProjectID:      projectID,
		ID:             id,
		Layout:         domain.BrandingLayoutSplit,
		LiquidTemplate: `<zl-page-shell>{% mandatory_gates %}</zl-page-shell>`,
		LogoURL:        "https://cdn.example.com/logo.svg",
		FontURL:        "https://fonts.example.com/css2",
		HeroURL:        "https://cdn.example.com/hero.png",
	}
}

func TestBrandingRepository_CreateAndGet(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	ensureProject(t, tx, "proj-brnd-1")
	repo := repository.NewBrandingRepository(tx)
	branding := sampleBranding("proj-brnd-1", "brnd-1")

	require.NoError(t, repo.Create(t.Context(), tx, branding))

	got, err := repo.GetByID(t.Context(), tx, "proj-brnd-1", "brnd-1")
	require.NoError(t, err)

	assert.Equal(t, branding.ProjectID, got.ProjectID)
	assert.Equal(t, branding.ID, got.ID)
	assert.Equal(t, branding.Layout, got.Layout)
	assert.Equal(t, branding.LiquidTemplate, got.LiquidTemplate)
	assert.Equal(t, branding.LogoURL, got.LogoURL)
	assert.Equal(t, branding.FontURL, got.FontURL)
	assert.Equal(t, branding.HeroURL, got.HeroURL)
	assert.WithinDuration(t, time.Now(), got.CreatedAt, 5*time.Second)
}

func TestBrandingRepository_GetLatest(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	ensureProject(t, tx, "proj-brnd-2")
	repo := repository.NewBrandingRepository(tx)

	// Within one transaction both rows share NOW() as created_at; resolution
	// falls back to the time-ordered id, which these fixture ids mimic.
	first := sampleBranding("proj-brnd-2", "brnd-001")
	require.NoError(t, repo.Create(t.Context(), tx, first))

	second := sampleBranding("proj-brnd-2", "brnd-002")
	second.LiquidTemplate = `<p data-rev="2">{% mandatory_gates %}</p>`
	require.NoError(t, repo.Create(t.Context(), tx, second))

	got, err := repo.GetLatest(t.Context(), tx, "proj-brnd-2")
	require.NoError(t, err)
	assert.Equal(t, "brnd-002", got.ID)
	assert.Equal(t, second.LiquidTemplate, got.LiquidTemplate)
}

func TestBrandingRepository_GetLatestNoRows(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	ensureProject(t, tx, "proj-brnd-3")
	repo := repository.NewBrandingRepository(tx)

	_, err := repo.GetLatest(t.Context(), tx, "proj-brnd-3")
	var noRow *database.NoRowFoundError
	require.True(t, errors.As(err, &noRow), "expected NoRowFoundError, got %v", err)
}

func TestBrandingRepository_ListNewestFirst(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	ensureProject(t, tx, "proj-brnd-4")
	repo := repository.NewBrandingRepository(tx)

	require.NoError(t, repo.Create(t.Context(), tx, sampleBranding("proj-brnd-4", "brnd-a")))
	require.NoError(t, repo.Create(t.Context(), tx, sampleBranding("proj-brnd-4", "brnd-b")))

	got, err := repo.List(t.Context(), tx,
		database.WithCondition(repo.ProjectIDCondition("proj-brnd-4")),
		database.WithOrderByDescending(repo.CreatedAt(), repo.ID()),
	)
	require.NoError(t, err)
	require.Len(t, got, 2)
	assert.Equal(t, "brnd-b", got[0].ID)
	assert.Equal(t, "brnd-a", got[1].ID)
}
