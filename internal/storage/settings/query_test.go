package settings_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/settings"
)

// VisibleTo has to agree with HasAccessTo exactly: a row the SQL filter admits
// but the domain predicate rejects is wasted IO, and one the SQL filter admits
// that the domain would reject would be a leak if a caller ever skipped Resolve.
// Rather than assert on compiled SQL, evaluate the domain predicate over every
// owner combination and check the two agree.
func TestVisibleTo_AgreesWithHasAccessTo(t *testing.T) {
	t.Parallel()

	ids := []string{"", "match", "other"}
	requester := domain.SettingOwner{
		ProjectID:     "match",
		TeamID:        "match",
		ApplicationID: "match",
		UserID:        "match",
	}

	for _, project := range ids {
		for _, team := range ids {
			for _, app := range ids {
				for _, user := range ids {
					leaf := &domain.SettingLeaf{Owner: domain.SettingOwner{
						ProjectID:     project,
						TeamID:        team,
						ApplicationID: app,
						UserID:        user,
					}}

					// The SQL filter admits a leaf when every column is either
					// unset or equal to the requester's, which is the predicate
					// ownerScope compiles per column.
					admitted := (project == "" || project == requester.ProjectID) &&
						(team == "" || team == requester.TeamID) &&
						(app == "" || app == requester.ApplicationID) &&
						(user == "" || user == requester.UserID)

					assert.Equal(t, admitted, requester.HasAccessTo(leaf),
						"project=%q team=%q application=%q user=%q", project, team, app, user)
				}
			}
		}
	}
}

func TestToDomain_GroupsByPath(t *testing.T) {
	t.Parallel()

	// Deliberately not in path order, to prove grouping does not depend on it.
	rows := []*settings.SettingStorage{
		{Path: "b.setting", ProjectID: "project-1", Value: "b-project"},
		{Path: "a.setting", ProjectID: "project-1", Value: "a-project"},
		{Path: "a.setting", ProjectID: "project-1", TeamID: "team-1", Value: "a-team", IsFinal: true},
	}

	got := settings.ToDomain(rows)
	require.Len(t, got, 2)

	assert.Equal(t, "a.setting", got[0].ID, "settings are ordered by path")
	assert.Equal(t, "b.setting", got[1].ID)

	require.Len(t, got[0].Leafs, 2)
	assert.Equal(t, "a-project", got[0].Leafs[0].Value)
	assert.Equal(t, domain.SettingOwnerLevelProject, got[0].Leafs[0].Owner.Level())
	assert.Equal(t, "a-team", got[0].Leafs[1].Value)
	assert.True(t, got[0].Leafs[1].IsFinal)
	assert.Equal(t, domain.SettingOwnerLevelTeam, got[0].Leafs[1].Owner.Level())

	require.Len(t, got[1].Leafs, 1)
	assert.Equal(t, "b-project", got[1].Leafs[0].Value)
}

func TestToDomain_Empty(t *testing.T) {
	t.Parallel()

	assert.Empty(t, settings.ToDomain(nil))
}

// The rows a dialect scans in AncestorFirst order must already be in the order
// Resolve wants, so its sort is a no-op rather than a reordering.
func TestToDomain_ResolvesThroughTheScannedOrder(t *testing.T) {
	t.Parallel()

	requester := domain.SettingOwner{
		ProjectID:     "project-1",
		TeamID:        "team-1",
		ApplicationID: "application-1",
		UserID:        "user-1",
	}
	// AncestorFirst sorts the owner columns ascending; the empty string sorts
	// before any id, so this is the order a dialect hands back.
	rows := []*settings.SettingStorage{
		{Path: "a", Value: "root"},
		{Path: "a", ProjectID: "project-1", Value: "project"},
		{Path: "a", ProjectID: "project-1", TeamID: "team-1", Value: "team"},
		{Path: "a", ProjectID: "project-1", TeamID: "team-1", ApplicationID: "application-1", Value: "application"},
	}

	got := settings.ToDomain(rows)
	require.Len(t, got, 1)

	leaf := got[0].Resolve(requester)
	require.NotNil(t, leaf)
	assert.Equal(t, "application", leaf.Value, "the nearest owned leaf wins")
}
