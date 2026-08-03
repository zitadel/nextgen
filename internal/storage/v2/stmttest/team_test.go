//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestTeamStatements_GetByID(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("returns_created_team", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			teamID := "team-" + uniqueSuffix(t)
			team := newTestTeam(projectID, teamID)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
			assert.Equal(t, domain.TeamStatusActive, team.Status)

			got, err := d.stmts.GetTeamByID(t.Context(), projectID, teamID)
			require.NoError(t, err)
			assert.Equal(t, projectID, got.ProjectID)
			assert.Equal(t, teamID, got.ID)
			assert.Equal(t, team.Name, got.Name)
			assert.Equal(t, domain.TeamStatusActive, got.Status)
			assert.False(t, got.CreatedAt.IsZero())
			assert.False(t, got.UpdatedAt.IsZero())
		})

		t.Run("missing_returns_NoRowFoundError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			_, err := d.stmts.GetTeamByID(t.Context(), projectID, "missing-team")
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})
	})
}

func TestTeamStatements_UpdateTeam(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("updates_name_and_timestamps", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			team := newTestTeam(projectID, "team-"+uniqueSuffix(t))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
			createdAt, updatedAt := team.CreatedAt, team.UpdatedAt

			team.Name = "updated name " + uniqueSuffix(t)
			require.NoError(t, d.stmts.UpdateTeam(t.Context(), team))
			assert.Equal(t, projectID, team.ProjectID)
			assert.Equal(t, domain.TeamStatusActive, team.Status)
			assert.Equal(t, createdAt, team.CreatedAt)
			assert.True(t, team.UpdatedAt.After(updatedAt) || team.UpdatedAt.Equal(updatedAt))
		})

		t.Run("missing_returns_NoRowFoundError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			team := newTestTeam(projectID, "missing-"+uniqueSuffix(t))
			assert.ErrorIs(t, d.stmts.UpdateTeam(t.Context(), team), new(database.NoRowFoundError))
		})

		t.Run("deactivated_returns_NoRowFoundError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			teamID := "team-" + uniqueSuffix(t)
			team := newTestTeam(projectID, teamID)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
			require.NoError(t, d.stmts.DeactivateTeam(t.Context(), projectID, teamID))

			team.Name = "updated name"
			assert.ErrorIs(t, d.stmts.UpdateTeam(t.Context(), team), new(database.NoRowFoundError))
		})

		t.Run("duplicate_name_returns_UniqueError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			team := newTestTeam(projectID, "team-"+uniqueSuffix(t))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))

			taken := newTestTeam(projectID, "team-"+uniqueSuffix(t))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), taken))

			team.Name = taken.Name
			assert.ErrorIs(t, d.stmts.UpdateTeam(t.Context(), team), new(database.UniqueError))

			team.Name = strings.ToUpper(taken.Name)
			assert.ErrorIs(t, d.stmts.UpdateTeam(t.Context(), team), new(database.UniqueError))
		})

		t.Run("unchanged_name_ok", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			team := newTestTeam(projectID, "team-"+uniqueSuffix(t))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
			name := team.Name
			require.NoError(t, d.stmts.UpdateTeam(t.Context(), team))
			assert.Equal(t, name, team.Name)
		})

		t.Run("same_name_other_project_ok", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			team := newTestTeam(projectID, "team-"+uniqueSuffix(t))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))

			otherProjectID := ensureProject(t, d.stmts)
			other := newTestTeam(otherProjectID, "team-"+uniqueSuffix(t))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), other))

			other.Name = team.Name
			require.NoError(t, d.stmts.UpdateTeam(t.Context(), other))
			assert.Equal(t, team.Name, other.Name)
		})
	})
}

func TestTeamStatements_List(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		// Three teams in one project are the fixture set; a team in a second
		// project guards the project scoping.
		projectID := ensureProject(t, d.stmts)
		otherProjectID := ensureProject(t, d.stmts)

		teams := make([]*domain.Team, 3)
		for i := range teams {
			if i > 0 {
				time.Sleep(2 * time.Millisecond)
			}
			team := newTestTeam(projectID, "team-"+strconv.Itoa(i))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
			teams[i] = team
		}
		ids := teamIDs(teams)

		otherTeam := newTestTeam(otherProjectID, "team-other")
		require.NoError(t, d.stmts.CreateTeam(t.Context(), otherTeam))

		createdAtCol := database.Col(domain.TeamFieldCreatedAt)
		idCol := database.Col(domain.TeamFieldID)
		projectCol := database.Col(domain.TeamFieldProjectID)
		// Pin every assertion to the three ordered fixtures, so subtests that
		// add teams to this project cannot shift another subtest's expectation.
		onlyFixtures := database.And(
			database.Equal(projectCol, projectID),
			database.Or(
				database.Equal(idCol, ids[0]),
				database.Equal(idCol, ids[1]),
				database.Equal(idCol, ids[2]),
			),
		)

		// Filter bounds come from the stored rows, not from what CreateTeam wrote
		// back: the Spanner emulator returns a created_at from THEN RETURN that
		// is a few hundred microseconds off the value it commits.
		read, err := d.stmts.ListTeams(t.Context(), &database.ListOptions[domain.TeamField]{
			Filter: onlyFixtures,
			Pagination: database.Page[domain.TeamField]{
				OrderBy: database.OrderBy[domain.TeamField]{
					Columns:   []database.Column[domain.TeamField]{createdAtCol, idCol},
					Direction: database.OrderAsc,
				},
			},
		})
		require.NoError(t, err)
		require.Len(t, read.Items, len(teams))
		stored := read.Items
		require.Equal(t, ids, teamIDs(stored), "stored order must match creation order")

		list := func(t *testing.T, filter database.Filter[domain.TeamField], dir database.OrderDirection) []string {
			t.Helper()
			res, err := d.stmts.ListTeams(t.Context(), &database.ListOptions[domain.TeamField]{
				Filter: database.And(onlyFixtures, filter),
				Pagination: database.Page[domain.TeamField]{
					OrderBy: database.OrderBy[domain.TeamField]{
						Columns:   []database.Column[domain.TeamField]{createdAtCol},
						Direction: dir,
					},
				},
			})
			require.NoError(t, err)
			return teamIDs(res.Items)
		}

		t.Run("scopes results to the project", func(t *testing.T) {
			res, err := d.stmts.ListTeams(t.Context(), &database.ListOptions[domain.TeamField]{
				Filter: database.Equal(projectCol, otherProjectID),
			})
			require.NoError(t, err)
			assert.Equal(t, []string{otherTeam.ID}, teamIDs(res.Items))
		})

		t.Run("returns the stored team", func(t *testing.T) {
			res, err := d.stmts.ListTeams(t.Context(), &database.ListOptions[domain.TeamField]{
				Filter: database.And(onlyFixtures, database.Equal(idCol, ids[0])),
			})
			require.NoError(t, err)
			require.Len(t, res.Items, 1)
			assert.Equal(t, projectID, res.Items[0].ProjectID)
			assert.Equal(t, teams[0].Name, res.Items[0].Name)
			assert.Equal(t, domain.TeamStatusActive, res.Items[0].Status)
			assert.False(t, res.Items[0].CreatedAt.IsZero())
			assert.False(t, res.Items[0].UpdatedAt.IsZero())
			assert.WithinDuration(t, time.Now(), res.Items[0].CreatedAt, time.Minute)
		})

		t.Run("lists a deactivated team", func(t *testing.T) {
			// Own project: DeactivateTeam cascades to the project's users and
			// memberships, which must not touch the shared fixtures.
			deactivatedProjectID := ensureProject(t, d.stmts)
			team := newTestTeam(deactivatedProjectID, "team-deactivated")
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
			require.NoError(t, d.stmts.DeactivateTeam(t.Context(), deactivatedProjectID, team.ID))

			res, err := d.stmts.ListTeams(t.Context(), &database.ListOptions[domain.TeamField]{
				Filter: database.Equal(projectCol, deactivatedProjectID),
			})
			require.NoError(t, err)
			require.Len(t, res.Items, 1)
			assert.Equal(t, team.ID, res.Items[0].ID)
			assert.Equal(t, domain.TeamStatusDeactivated, res.Items[0].Status)
		})

		t.Run("filters by created_at equal", func(t *testing.T) {
			assert.Equal(t, []string{ids[1]}, list(t, database.Equal(createdAtCol, stored[1].CreatedAt), database.OrderAsc))
		})

		t.Run("filters by created_at greater than", func(t *testing.T) {
			assert.Equal(t, []string{ids[2]}, list(t, database.GreaterThan(createdAtCol, stored[1].CreatedAt), database.OrderAsc))
		})

		t.Run("filters by created_at less than", func(t *testing.T) {
			assert.Equal(t, []string{ids[0]}, list(t, database.LessThan(createdAtCol, stored[1].CreatedAt), database.OrderAsc))
		})

		t.Run("filters by a created_at range", func(t *testing.T) {
			assert.Equal(t, []string{ids[1]}, list(t, database.And(
				database.GreaterThan(createdAtCol, stored[0].CreatedAt),
				database.LessThan(createdAtCol, stored[2].CreatedAt),
			), database.OrderAsc))
		})

		t.Run("sorts by created_at ascending", func(t *testing.T) {
			assert.Equal(t, []string{ids[0], ids[1], ids[2]}, list(t, nil, database.OrderAsc))
		})

		t.Run("sorts by created_at descending", func(t *testing.T) {
			assert.Equal(t, []string{ids[2], ids[1], ids[0]}, list(t, nil, database.OrderDesc))
		})

		cursorTests := []struct {
			name    string
			columns []database.Column[domain.TeamField]
		}{
			{"paginates with a cursor", []database.Column[domain.TeamField]{createdAtCol}},
			{"paginates with a tiebreaker column", []database.Column[domain.TeamField]{createdAtCol, idCol}},
		}

		for _, tc := range cursorTests {
			t.Run(tc.name, func(t *testing.T) {
				page := database.Page[domain.TeamField]{
					Limit: 2,
					OrderBy: database.OrderBy[domain.TeamField]{
						Columns:   tc.columns,
						Direction: database.OrderAsc,
					},
				}

				first, err := d.stmts.ListTeams(t.Context(), &database.ListOptions[domain.TeamField]{Filter: onlyFixtures, Pagination: page})
				require.NoError(t, err)
				assert.Equal(t, []string{ids[0], ids[1]}, teamIDs(first.Items))
				require.NotEmpty(t, first.NextCursor)

				page.Cursor = first.NextCursor
				second, err := d.stmts.ListTeams(t.Context(), &database.ListOptions[domain.TeamField]{Filter: onlyFixtures, Pagination: page})
				require.NoError(t, err)
				assert.Equal(t, []string{ids[2]}, teamIDs(second.Items))
				assert.Empty(t, second.NextCursor)
			})
		}

		t.Run("paginates under a created_at filter", func(t *testing.T) {
			filter := database.And(onlyFixtures, database.GreaterThan(createdAtCol, stored[0].CreatedAt))
			page := database.Page[domain.TeamField]{
				Limit: 1,
				OrderBy: database.OrderBy[domain.TeamField]{
					Columns:   []database.Column[domain.TeamField]{createdAtCol},
					Direction: database.OrderAsc,
				},
			}

			first, err := d.stmts.ListTeams(t.Context(), &database.ListOptions[domain.TeamField]{Filter: filter, Pagination: page})
			require.NoError(t, err)
			assert.Equal(t, []string{ids[1]}, teamIDs(first.Items))
			require.NotEmpty(t, first.NextCursor)

			page.Cursor = first.NextCursor
			second, err := d.stmts.ListTeams(t.Context(), &database.ListOptions[domain.TeamField]{Filter: filter, Pagination: page})
			require.NoError(t, err)
			assert.Equal(t, []string{ids[2]}, teamIDs(second.Items))

			page.Cursor = second.NextCursor
			third, err := d.stmts.ListTeams(t.Context(), &database.ListOptions[domain.TeamField]{Filter: filter, Pagination: page})
			require.NoError(t, err)
			assert.Empty(t, teamIDs(third.Items))
		})
	})
}

func teamIDs(teams []*domain.Team) []string {
	ids := make([]string, len(teams))
	for i, team := range teams {
		ids[i] = team.ID
	}
	return ids
}
