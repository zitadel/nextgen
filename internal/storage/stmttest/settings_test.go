//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// settingsBranch is one project/team/application/user chain plus a path, all
// suffixed per test so cases never collide in a shared database.
type settingsBranch struct {
	path    string
	project domain.SettingOwner
	team    domain.SettingOwner
	app     domain.SettingOwner
	user    domain.SettingOwner
}

func newSettingsBranch(t *testing.T) settingsBranch {
	t.Helper()
	suffix := uniqueSuffix(t)
	project := domain.SettingOwner{ProjectID: "proj-set-" + suffix}
	team := project
	team.TeamID = "team-set-" + suffix
	app := team
	app.ApplicationID = "app-set-" + suffix
	user := app
	user.UserID = "user-set-" + suffix
	return settingsBranch{
		path:    "login.appearance." + suffix,
		project: project,
		team:    team,
		app:     app,
		user:    user,
	}
}

func setSetting(t *testing.T, stmts service.AllStatements, owner domain.SettingOwner, path string, value any, isFinal bool) {
	t.Helper()
	require.NoError(t, stmts.SetSetting(t.Context(), owner, path, value, isFinal))
	t.Cleanup(func() { _ = stmts.DeleteSetting(context.Background(), owner, path) })
}

// resolveFor is the read path as a service would use it: fetch the leaves the
// requester may see, then let the domain resolve across them.
func resolveFor(t *testing.T, stmts service.AllStatements, requester domain.SettingOwner, path string) *domain.SettingLeaf {
	t.Helper()
	got, err := stmts.GetSettings(t.Context(), requester, path)
	require.NoError(t, err)
	if len(got) == 0 {
		return nil
	}
	require.Len(t, got, 1)
	require.Equal(t, path, got[0].ID)
	return got[0].Resolve(requester)
}

func TestSettingsStatements_ResolvesNearestOwner(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		b := newSettingsBranch(t)
		setSetting(t, d.stmts, b.project, b.path, "project-value", false)
		setSetting(t, d.stmts, b.team, b.path, "team-value", false)
		setSetting(t, d.stmts, b.app, b.path, "app-value", false)
		setSetting(t, d.stmts, b.user, b.path, "user-value", false)

		for _, tc := range []struct {
			name      string
			requester domain.SettingOwner
			expected  string
		}{
			{"project requester", b.project, "project-value"},
			{"team requester", b.team, "team-value"},
			{"application requester", b.app, "app-value"},
			{"user requester", b.user, "user-value"},
		} {
			t.Run(tc.name, func(t *testing.T) {
				leaf := resolveFor(t, d.stmts, tc.requester, b.path)
				require.NotNil(t, leaf)
				assert.Equal(t, tc.expected, leaf.Value)
			})
		}
	})
}

func TestSettingsStatements_InheritsWhenLevelUnset(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		b := newSettingsBranch(t)
		setSetting(t, d.stmts, b.project, b.path, "project-value", false)

		// Nothing is written below project, so every deeper requester inherits.
		for _, requester := range []domain.SettingOwner{b.team, b.app, b.user} {
			leaf := resolveFor(t, d.stmts, requester, b.path)
			require.NotNil(t, leaf)
			assert.Equal(t, "project-value", leaf.Value)
		}
	})
}

// A leaf written below the requester must not leak upward: a project-level
// requester cannot see a value its own team set.
func TestSettingsStatements_DoesNotLeakDownwardLeaves(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		b := newSettingsBranch(t)
		setSetting(t, d.stmts, b.team, b.path, "team-value", false)

		assert.Nil(t, resolveFor(t, d.stmts, b.project, b.path))

		leaf := resolveFor(t, d.stmts, b.team, b.path)
		require.NotNil(t, leaf)
		assert.Equal(t, "team-value", leaf.Value)
	})
}

// The filter is per branch, not per level: a sibling team's leaf at the same
// level must never reach this requester.
func TestSettingsStatements_DoesNotLeakSiblingBranches(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		b := newSettingsBranch(t)
		sibling := b.team
		sibling.TeamID += "-sibling"

		setSetting(t, d.stmts, b.project, b.path, "project-value", false)
		setSetting(t, d.stmts, sibling, b.path, "sibling-team-value", false)

		leaf := resolveFor(t, d.stmts, b.team, b.path)
		require.NotNil(t, leaf)
		assert.Equal(t, "project-value", leaf.Value, "sibling team leaf must not be visible")
	})
}

func TestSettingsStatements_FinalStopsDescendantOverride(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		b := newSettingsBranch(t)
		setSetting(t, d.stmts, b.project, b.path, "project-value", true)
		setSetting(t, d.stmts, b.user, b.path, "user-value", false)

		leaf := resolveFor(t, d.stmts, b.user, b.path)
		require.NotNil(t, leaf)
		assert.Equal(t, "project-value", leaf.Value, "final project leaf outranks the user leaf")
	})
}

// The natural key is the primary key, so rewriting at one owner replaces that
// leaf rather than adding a second one at the same level.
func TestSettingsStatements_SetIsUpsertPerOwner(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		b := newSettingsBranch(t)
		setSetting(t, d.stmts, b.team, b.path, "first", false)
		require.NoError(t, d.stmts.SetSetting(t.Context(), b.team, b.path, "second", true))

		got, err := d.stmts.GetSettings(t.Context(), b.team, b.path)
		require.NoError(t, err)
		require.Len(t, got, 1)
		require.Len(t, got[0].Leafs, 1, "rewrite must replace the leaf, not add one")
		assert.Equal(t, "second", got[0].Leafs[0].Value)
		assert.True(t, got[0].Leafs[0].IsFinal)
	})
}

func TestSettingsStatements_GetSettingsFiltersByPath(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		b := newSettingsBranch(t)
		other := b.path + ".other"
		setSetting(t, d.stmts, b.team, b.path, "value", false)
		setSetting(t, d.stmts, b.team, other, "other-value", false)

		got, err := d.stmts.GetSettings(t.Context(), b.team, b.path)
		require.NoError(t, err)
		require.Len(t, got, 1)
		assert.Equal(t, b.path, got[0].ID)

		both, err := d.stmts.GetSettings(t.Context(), b.team, b.path, other)
		require.NoError(t, err)
		require.Len(t, both, 2)
		assert.Equal(t, b.path, both[0].ID, "settings come back ordered by path")
		assert.Equal(t, other, both[1].ID)
	})
}

// Values round-trip through the JSON column, not just strings.
func TestSettingsStatements_ValueRoundTrip(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		b := newSettingsBranch(t)
		setSetting(t, d.stmts, b.team, b.path, map[string]any{"radius": float64(8), "label": "on"}, false)

		leaf := resolveFor(t, d.stmts, b.team, b.path)
		require.NotNil(t, leaf)
		assert.Equal(t, map[string]any{"radius": float64(8), "label": "on"}, leaf.Value)
	})
}

func TestSettingsStatements_DeleteOnlyRemovesOwnLeaf(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		b := newSettingsBranch(t)
		setSetting(t, d.stmts, b.project, b.path, "project-value", false)
		setSetting(t, d.stmts, b.team, b.path, "team-value", false)

		require.NoError(t, d.stmts.DeleteSetting(t.Context(), b.team, b.path))

		// The inherited project leaf survives and now resolves for the team.
		leaf := resolveFor(t, d.stmts, b.team, b.path)
		require.NotNil(t, leaf)
		assert.Equal(t, "project-value", leaf.Value)
	})
}

func TestSettingsStatements_DeleteMissingReturnsNoRowFound(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		b := newSettingsBranch(t)
		err := d.stmts.DeleteSetting(t.Context(), b.team, b.path)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}
