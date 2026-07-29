//go:build spanner_integration

package spanner

import (
	"context"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/branding"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func uniqueBrandingIDs(t *testing.T) (projectID, brandingID string) {
	t.Helper()
	suffix := strings.ReplaceAll(t.Name(), "/", "_") + "-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	return "proj-brnd-" + suffix, "brnd-" + suffix
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
	ctx := t.Context()
	stmts := testClient.Statements()

	projectID, brandingID := uniqueBrandingIDs(t)
	project := newTestProject(projectID)
	require.NoError(t, stmts.CreateProject(ctx, project))
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), projectID) })

	entity := sampleBranding(projectID, brandingID)
	require.NoError(t, stmts.CreateBranding(ctx, entity))
	assert.False(t, entity.CreatedAt.IsZero())

	got, err := stmts.GetBrandingByID(ctx, projectID, brandingID)
	require.NoError(t, err)
	assert.Equal(t, entity.ProjectID, got.ProjectID)
	assert.Equal(t, entity.ID, got.ID)
	assert.Equal(t, entity.Layout, got.Layout)
	assert.Equal(t, entity.LiquidTemplate, got.LiquidTemplate)
	assert.Equal(t, entity.LogoURL, got.LogoURL)
	assert.Equal(t, entity.FontURL, got.FontURL)
	assert.Equal(t, entity.HeroURL, got.HeroURL)
	assert.Equal(t, entity.CreatedAt.UTC(), got.CreatedAt.UTC())
}

func TestBrandingStatements_ListNewestFirst(t *testing.T) {
	ctx := t.Context()
	stmts := testClient.Statements()

	projectID, _ := uniqueBrandingIDs(t)
	project := newTestProject(projectID)
	require.NoError(t, stmts.CreateProject(ctx, project))
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), projectID) })

	first := sampleBranding(projectID, "brnd-001")
	require.NoError(t, stmts.CreateBranding(ctx, first))

	second := sampleBranding(projectID, "brnd-002")
	second.LiquidTemplate = `<p data-rev="2">{% mandatory_gates %}</p>`
	require.NoError(t, stmts.CreateBranding(ctx, second))

	got, err := stmts.ListBrandings(ctx, branding.ListOptions(projectID, 0))
	require.NoError(t, err)
	require.Len(t, got.Items, 2)
	assert.Equal(t, "brnd-002", got.Items[0].ID)
	assert.Equal(t, second.LiquidTemplate, got.Items[0].LiquidTemplate)
	assert.Equal(t, "brnd-001", got.Items[1].ID)

	latest, err := stmts.ListBrandings(ctx, branding.ListOptions(projectID, 1))
	require.NoError(t, err)
	require.Len(t, latest.Items, 1)
	assert.Equal(t, "brnd-002", latest.Items[0].ID)
}

func TestBrandingStatements_ListEmpty(t *testing.T) {
	ctx := t.Context()
	stmts := testClient.Statements()

	projectID, _ := uniqueBrandingIDs(t)
	project := newTestProject(projectID)
	require.NoError(t, stmts.CreateProject(ctx, project))
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), projectID) })

	got, err := stmts.ListBrandings(ctx, branding.ListOptions(projectID, 1))
	require.NoError(t, err)
	assert.Empty(t, got.Items)
}

func TestBrandingStatements_Get_NotFound(t *testing.T) {
	ctx := t.Context()
	stmts := testClient.Statements()

	projectID, brandingID := uniqueBrandingIDs(t)
	project := newTestProject(projectID)
	require.NoError(t, stmts.CreateProject(ctx, project))
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), projectID) })

	_, err := stmts.GetBrandingByID(ctx, projectID, brandingID)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}
