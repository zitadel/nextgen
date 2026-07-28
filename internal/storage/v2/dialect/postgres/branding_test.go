//go:build postgres_integration

package postgres

import (
	"context"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	legacydb "github.com/zitadel/nextgen/internal/storage/database"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
)

func uniqueBrandingIDs(t *testing.T) (projectID, brandingID string) {
	t.Helper()
	suffix := strings.ReplaceAll(t.Name(), "/", "_") + "-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	return "proj-brnd-" + suffix, "brnd-" + suffix
}

func ensureBrandingProject(t *testing.T, projectID string) {
	t.Helper()
	project := newTestProject(projectID)
	require.NoError(t, testPool.CreateProject(t.Context(), project))
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })
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
	projectID, brandingID := uniqueBrandingIDs(t)
	ensureBrandingProject(t, projectID)

	branding := sampleBranding(projectID, brandingID)
	require.NoError(t, testPool.CreateBranding(t.Context(), branding))
	assert.False(t, branding.CreatedAt.IsZero())
	assert.WithinDuration(t, time.Now(), branding.CreatedAt, 5*time.Second)

	got, err := testPool.GetBrandingByID(t.Context(), projectID, brandingID)
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

func TestBrandingStatements_GetLatest(t *testing.T) {
	projectID, _ := uniqueBrandingIDs(t)
	ensureBrandingProject(t, projectID)

	// Within one transaction both rows share NOW() as created_at; resolution
	// falls back to the time-ordered id, which these fixture ids mimic.
	first := sampleBranding(projectID, "brnd-001")
	require.NoError(t, testPool.CreateBranding(t.Context(), first))

	second := sampleBranding(projectID, "brnd-002")
	second.LiquidTemplate = `<p data-rev="2">{% mandatory_gates %}</p>`
	require.NoError(t, testPool.CreateBranding(t.Context(), second))

	got, err := testPool.GetLatestBranding(t.Context(), projectID)
	require.NoError(t, err)
	assert.Equal(t, "brnd-002", got.ID)
	assert.Equal(t, second.LiquidTemplate, got.LiquidTemplate)
}

func TestBrandingStatements_GetLatestNoRows(t *testing.T) {
	projectID, _ := uniqueBrandingIDs(t)
	ensureBrandingProject(t, projectID)

	_, err := testPool.GetLatestBranding(t.Context(), projectID)
	assert.ErrorIs(t, err, new(legacydb.NoRowFoundError))
}

func TestBrandingStatements_ListNewestFirst(t *testing.T) {
	projectID, _ := uniqueBrandingIDs(t)
	ensureBrandingProject(t, projectID)

	require.NoError(t, testPool.CreateBranding(t.Context(), sampleBranding(projectID, "brnd-a")))
	require.NoError(t, testPool.CreateBranding(t.Context(), sampleBranding(projectID, "brnd-b")))

	got, err := testPool.ListBrandings(t.Context(), &v2database.ListOptions[domain.BrandingField]{
		Filter: v2database.Equal(v2database.Col(domain.BrandingFieldProjectID), projectID),
		Pagination: v2database.Page[domain.BrandingField]{
			OrderBy: v2database.OrderBy[domain.BrandingField]{
				Columns: []v2database.Column[domain.BrandingField]{
					v2database.Col(domain.BrandingFieldCreatedAt),
					v2database.Col(domain.BrandingFieldID),
				},
				Direction: v2database.OrderDesc,
			},
		},
	})
	require.NoError(t, err)
	require.Len(t, got.Items, 2)
	assert.Equal(t, "brnd-b", got.Items[0].ID)
	assert.Equal(t, "brnd-a", got.Items[1].ID)
}

func TestBrandingStatements_Get_NotFound(t *testing.T) {
	projectID, brandingID := uniqueBrandingIDs(t)
	ensureBrandingProject(t, projectID)

	_, err := testPool.GetBrandingByID(t.Context(), projectID, brandingID)
	assert.ErrorIs(t, err, new(legacydb.NoRowFoundError))
}
