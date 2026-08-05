//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/branding"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func uniqueBrandingIDs(t *testing.T) (projectID, brandingID string) {
	t.Helper()
	suffix := uniqueSuffix(t)
	return "proj-brnd-" + suffix, "brnd-" + suffix
}

func ensureBrandingProject(t *testing.T, stmts service.AllStatements, projectID string) {
	t.Helper()
	project := newTestProject(projectID)
	require.NoError(t, stmts.CreateProject(t.Context(), project))
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), projectID) })
}

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

func TestBrandingStatements_CreateAndGet(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, brandingID := uniqueBrandingIDs(t)
		ensureBrandingProject(t, d.stmts, projectID)

		entity := sampleBranding(projectID, brandingID)
		require.NoError(t, d.stmts.CreateBranding(t.Context(), entity))
		assert.False(t, entity.CreatedAt.IsZero())
		assert.WithinDuration(t, time.Now(), entity.CreatedAt, 5*time.Second)

		got, err := d.stmts.GetBrandingByID(t.Context(), projectID, brandingID)
		require.NoError(t, err)

		assert.Equal(t, entity.ProjectID, got.ProjectID)
		assert.Equal(t, entity.ID, got.ID)
		assert.Equal(t, entity.Layout, got.Layout)
		assert.Equal(t, entity.LiquidTemplate, got.LiquidTemplate)
		assert.Equal(t, entity.LogoURL, got.LogoURL)
		assert.Equal(t, entity.FontURL, got.FontURL)
		assert.Equal(t, entity.HeroURL, got.HeroURL)
		assert.WithinDuration(t, time.Now(), got.CreatedAt, 5*time.Second)
	})
}

func TestBrandingStatements_Create_EmptyIDAssigned(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniqueBrandingIDs(t)
		ensureBrandingProject(t, d.stmts, projectID)

		entity := sampleBranding(projectID, "")
		require.NoError(t, d.stmts.CreateBranding(t.Context(), entity))
		require.NotEmpty(t, entity.ID)
		assert.True(t, strings.HasPrefix(entity.ID, string(domain.PrefixBranding)+"_"))

		got, err := d.stmts.GetBrandingByID(t.Context(), projectID, entity.ID)
		require.NoError(t, err)
		assert.Equal(t, entity.ID, got.ID)
	})
}

func TestBrandingStatements_ListNewestFirst(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniqueBrandingIDs(t)
		ensureBrandingProject(t, d.stmts, projectID)

		first := sampleBranding(projectID, "brnd-001")
		require.NoError(t, d.stmts.CreateBranding(t.Context(), first))

		second := sampleBranding(projectID, "brnd-002")
		second.LiquidTemplate = `<p data-rev="2">{% mandatory_gates %}</p>`
		require.NoError(t, d.stmts.CreateBranding(t.Context(), second))

		got, err := d.stmts.ListBrandings(t.Context(), branding.ListOptions(projectID, 0))
		require.NoError(t, err)
		require.Len(t, got.Items, 2)
		assert.Equal(t, "brnd-002", got.Items[0].ID)
		assert.Equal(t, second.LiquidTemplate, got.Items[0].LiquidTemplate)
		assert.Equal(t, "brnd-001", got.Items[1].ID)

		latest, err := d.stmts.ListBrandings(t.Context(), branding.ListOptions(projectID, 1))
		require.NoError(t, err)
		require.Len(t, latest.Items, 1)
		assert.Equal(t, "brnd-002", latest.Items[0].ID)
	})
}

func TestBrandingStatements_ListEmpty(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniqueBrandingIDs(t)
		ensureBrandingProject(t, d.stmts, projectID)

		got, err := d.stmts.ListBrandings(t.Context(), branding.ListOptions(projectID, 1))
		require.NoError(t, err)
		assert.Empty(t, got.Items)
	})
}

func TestBrandingStatements_Get_NotFound(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, brandingID := uniqueBrandingIDs(t)
		ensureBrandingProject(t, d.stmts, projectID)

		_, err := d.stmts.GetBrandingByID(t.Context(), projectID, brandingID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}
