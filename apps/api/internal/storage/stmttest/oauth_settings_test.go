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
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/oauthsettings"
)

func uniqueOAuthSettingsIDs(t *testing.T) (projectID, settingsID string) {
	t.Helper()
	suffix := uniqueSuffix(t)
	return "proj-oauthset-" + suffix, "oauthset-" + suffix
}

func ensureOAuthSettingsProject(t *testing.T, stmts service.AllStatements, projectID string) {
	t.Helper()
	project := newTestProject(projectID)
	require.NoError(t, stmts.CreateProject(t.Context(), project))
	t.Cleanup(func() { _, _ = stmts.DeleteProjectByID(context.Background(), projectID) })
}

func sampleOAuthSettings(projectID, id string) *domain.OAuthSettings {
	return &domain.OAuthSettings{
		ProjectID: projectID,
		ID:        id,
		Enabled:   true,
	}
}

func TestOAuthSettingsStatements_CreateAndGet(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, settingsID := uniqueOAuthSettingsIDs(t)
		ensureOAuthSettingsProject(t, d.stmts, projectID)

		entity := sampleOAuthSettings(projectID, settingsID)
		require.NoError(t, d.stmts.CreateOAuthSettings(t.Context(), entity))
		assert.False(t, entity.CreatedAt.IsZero())
		assert.WithinDuration(t, time.Now(), entity.CreatedAt, 5*time.Second)

		got, err := d.stmts.GetOAuthSettingsByID(t.Context(), projectID, settingsID)
		require.NoError(t, err)

		assert.Equal(t, entity.ProjectID, got.ProjectID)
		assert.Equal(t, entity.ID, got.ID)
		assert.True(t, got.Enabled)
		assert.WithinDuration(t, time.Now(), got.CreatedAt, 5*time.Second)
	})
}

// A disabled revision reads back disabled: the definition stores the false
// explicitly rather than leaving the field out.
func TestOAuthSettingsStatements_DisabledRoundTrips(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, settingsID := uniqueOAuthSettingsIDs(t)
		ensureOAuthSettingsProject(t, d.stmts, projectID)

		entity := sampleOAuthSettings(projectID, settingsID)
		entity.Enabled = false
		require.NoError(t, d.stmts.CreateOAuthSettings(t.Context(), entity))

		got, err := d.stmts.GetOAuthSettingsByID(t.Context(), projectID, settingsID)
		require.NoError(t, err)
		assert.False(t, got.Enabled)
	})
}

func TestOAuthSettingsStatements_Create_EmptyIDAssigned(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniqueOAuthSettingsIDs(t)
		ensureOAuthSettingsProject(t, d.stmts, projectID)

		entity := sampleOAuthSettings(projectID, "")
		require.NoError(t, d.stmts.CreateOAuthSettings(t.Context(), entity))
		require.NotEmpty(t, entity.ID)
		assert.True(t, strings.HasPrefix(entity.ID, string(domain.PrefixOAuthSettings)+"_"))

		got, err := d.stmts.GetOAuthSettingsByID(t.Context(), projectID, entity.ID)
		require.NoError(t, err)
		assert.Equal(t, entity.ID, got.ID)
	})
}

// Every revision indexes into the resource scope index under its own kind,
// so a grant on one revision resolves (ADR 032).
func TestOAuthSettingsStatements_Create_IndexesResourceScope(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, settingsID := uniqueOAuthSettingsIDs(t)
		ensureOAuthSettingsProject(t, d.stmts, projectID)

		require.NoError(t, d.stmts.CreateOAuthSettings(t.Context(), sampleOAuthSettings(projectID, settingsID)))

		scope, err := d.stmts.GetResourceScope(t.Context(), settingsID)
		require.NoError(t, err)
		assert.Equal(t, domain.ResourceKindOAuthSettings, scope.ResourceKind)
		assert.Equal(t, projectID, scope.ProjectID)
	})
}

func TestOAuthSettingsStatements_ListNewestFirst(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniqueOAuthSettingsIDs(t)
		ensureOAuthSettingsProject(t, d.stmts, projectID)

		first := sampleOAuthSettings(projectID, "oauthset-001")
		require.NoError(t, d.stmts.CreateOAuthSettings(t.Context(), first))

		second := sampleOAuthSettings(projectID, "oauthset-002")
		second.Enabled = false
		require.NoError(t, d.stmts.CreateOAuthSettings(t.Context(), second))

		got, err := d.stmts.ListOAuthSettings(unfilteredListCtx(t), oauthsettings.ListOptions(projectID, 0))
		require.NoError(t, err)
		require.Len(t, got.Items, 2)
		assert.Equal(t, "oauthset-002", got.Items[0].ID)
		assert.False(t, got.Items[0].Enabled)
		assert.Equal(t, "oauthset-001", got.Items[1].ID)
		assert.True(t, got.Items[1].Enabled)

		latest, err := d.stmts.ListOAuthSettings(unfilteredListCtx(t), oauthsettings.ListOptions(projectID, 1))
		require.NoError(t, err)
		require.Len(t, latest.Items, 1)
		assert.Equal(t, "oauthset-002", latest.Items[0].ID)
	})
}

func TestOAuthSettingsStatements_ListEmpty(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniqueOAuthSettingsIDs(t)
		ensureOAuthSettingsProject(t, d.stmts, projectID)

		got, err := d.stmts.ListOAuthSettings(unfilteredListCtx(t), oauthsettings.ListOptions(projectID, 1))
		require.NoError(t, err)
		assert.Empty(t, got.Items)
	})
}

func TestOAuthSettingsStatements_Get_NotFound(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, settingsID := uniqueOAuthSettingsIDs(t)
		ensureOAuthSettingsProject(t, d.stmts, projectID)

		_, err := d.stmts.GetOAuthSettingsByID(t.Context(), projectID, settingsID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// A revision of another project is not reachable through the first: the
// primary key is (project_id, id).
func TestOAuthSettingsStatements_Get_OtherProject(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, settingsID := uniqueOAuthSettingsIDs(t)
		ensureOAuthSettingsProject(t, d.stmts, projectID)
		otherProjectID, _ := uniqueOAuthSettingsIDs(t)
		ensureOAuthSettingsProject(t, d.stmts, otherProjectID)

		require.NoError(t, d.stmts.CreateOAuthSettings(t.Context(), sampleOAuthSettings(projectID, settingsID)))

		_, err := d.stmts.GetOAuthSettingsByID(t.Context(), otherProjectID, settingsID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}
