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
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func uniqueTeamID(t *testing.T) string {
	t.Helper()
	return "team-" + uniqueSuffix(t)
}

func TestTeamStatements_Create(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("creates team and timestamps are set", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			teamID := uniqueTeamID(t)

			team := newTestTeam(projectID, teamID)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
			assert.Equal(t, domain.TeamStatusActive, team.Status)
			assert.False(t, team.CreatedAt.IsZero())
			assert.False(t, team.UpdatedAt.IsZero())
			assert.WithinDuration(t, time.Now(), team.CreatedAt, 5*time.Second)

			stored, err := d.stmts.GetTeamByID(t.Context(), projectID, teamID)
			require.NoError(t, err)
			assert.Equal(t, projectID, stored.ProjectID)
			assert.Equal(t, teamID, stored.ID)
			assert.Equal(t, team.Name, stored.Name)
			assert.Equal(t, domain.TeamStatusActive, stored.Status)
		})

		t.Run("empty id is assigned by dialect", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)

			team := newTestTeam(projectID, "")
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))

			require.NotEmpty(t, team.ID)
			assert.True(t, strings.HasPrefix(team.ID, string(domain.PrefixTeam)+"_"))

			stored, err := d.stmts.GetTeamByID(t.Context(), projectID, team.ID)
			require.NoError(t, err)
			assert.Equal(t, team.ID, stored.ID)
		})

		t.Run("empty name returns error", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)

			team := newTestTeam(projectID, uniqueTeamID(t))
			team.Name = ""
			assert.ErrorIs(t, d.stmts.CreateTeam(t.Context(), team), new(database.CheckError))
		})

		t.Run("name over the length limit returns error", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)

			team := newTestTeam(projectID, uniqueTeamID(t))
			team.Name = strings.Repeat("a", domain.TeamNameMaxLength+1)
			assert.ErrorIs(t, d.stmts.CreateTeam(t.Context(), team), new(database.CheckError))
		})

		t.Run("duplicate (project_id, id) returns error", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			teamID := uniqueTeamID(t)

			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))

			err := d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID))
			assert.ErrorIs(t, err, new(database.UniqueError))
		})

		t.Run("duplicate name in the same project returns error", func(t *testing.T) {
			for _, tc := range []struct {
				name    string
				nameFor func(string) string
			}{
				{"exact match", func(name string) string { return name }},
				{"differing only in case", strings.ToUpper},
			} {
				t.Run(tc.name, func(t *testing.T) {
					projectID := ensureProject(t, d.stmts)
					teamID := uniqueTeamID(t)

					team := newTestTeam(projectID, teamID)
					require.NoError(t, d.stmts.CreateTeam(t.Context(), team))

					duplicate := newTestTeam(projectID, teamID+"-2")
					duplicate.Name = tc.nameFor(team.Name)
					err := d.stmts.CreateTeam(t.Context(), duplicate)
					assert.ErrorIs(t, err, new(database.UniqueError))
				})
			}
		})

		t.Run("same name in different projects is allowed", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			otherProjectID := ensureProject(t, d.stmts)
			teamID := uniqueTeamID(t)

			team := newTestTeam(projectID, teamID)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))

			other := newTestTeam(otherProjectID, teamID)
			other.Name = team.Name
			require.NoError(t, d.stmts.CreateTeam(t.Context(), other))
		})
	})
}

func TestTeamStatements_GetByID(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("returns team by project_id and id", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			teamID := uniqueTeamID(t)
			team := newTestTeam(projectID, teamID)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))

			stored, err := d.stmts.GetTeamByID(t.Context(), projectID, teamID)
			require.NoError(t, err)
			assert.Equal(t, projectID, stored.ProjectID)
			assert.Equal(t, teamID, stored.ID)
			assert.Equal(t, team.Name, stored.Name)
			assert.Equal(t, domain.TeamStatusActive, stored.Status)
			assert.False(t, stored.CreatedAt.IsZero())
			assert.False(t, stored.UpdatedAt.IsZero())
		})

		t.Run("not found returns NoRowFoundError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			_, err := d.stmts.GetTeamByID(t.Context(), projectID, "missing-team")
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})
	})
}

func TestTeamStatements_Get(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("returns active team with status filter", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			teamID := uniqueTeamID(t)
			team := newTestTeam(projectID, teamID)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))

			stored, err := d.stmts.GetTeam(t.Context(), database.And(
				database.Equal(database.Col(domain.TeamFieldProjectID), projectID),
				database.Equal(database.Col(domain.TeamFieldID), teamID),
				database.Equal(database.Col(domain.TeamFieldStatus), domain.TeamStatusActive.String()),
			))
			require.NoError(t, err)
			assert.Equal(t, teamID, stored.ID)
			assert.Equal(t, domain.TeamStatusActive, stored.Status)
		})

		t.Run("after deactivate, active filter is NoRowFoundError while GetTeamByID still finds it", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			teamID := uniqueTeamID(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))

			_, err := d.stmts.DeactivateTeam(t.Context(), projectID, teamID)
			require.NoError(t, err)

			_, err = d.stmts.GetTeam(t.Context(), database.And(
				database.Equal(database.Col(domain.TeamFieldProjectID), projectID),
				database.Equal(database.Col(domain.TeamFieldID), teamID),
				database.Equal(database.Col(domain.TeamFieldStatus), domain.TeamStatusActive.String()),
			))
			assert.ErrorIs(t, err, new(database.NoRowFoundError))

			stored, err := d.stmts.GetTeamByID(t.Context(), projectID, teamID)
			require.NoError(t, err)
			assert.Equal(t, domain.TeamStatusDeactivated, stored.Status)
		})
	})
}

func TestTeamStatements_UpdateTeam(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("updates team", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			teamID := uniqueTeamID(t)
			team := newTestTeam(projectID, teamID)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
			createdAt, updatedAt := team.CreatedAt, team.UpdatedAt

			team.Name = "updated name"
			require.NoError(t, d.stmts.UpdateTeam(t.Context(), team))
			assert.Equal(t, "updated name", team.Name)
			assert.Equal(t, projectID, team.ProjectID)
			assert.Equal(t, teamID, team.ID)
			assert.Equal(t, domain.TeamStatusActive, team.Status)
			assert.Equal(t, createdAt, team.CreatedAt)
			assert.True(t, team.UpdatedAt.After(updatedAt))
		})

		t.Run("team not found returns NoRowFoundError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			team := newTestTeam(projectID, "nonexistent")
			assert.ErrorIs(t,
				d.stmts.UpdateTeam(t.Context(), team),
				new(database.NoRowFoundError),
			)
		})

		t.Run("deactivated team returns NoRowFoundError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			teamID := uniqueTeamID(t)
			team := newTestTeam(projectID, teamID)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
			_, err := d.stmts.DeactivateTeam(t.Context(), projectID, teamID)
			require.NoError(t, err)

			team.Name = "updated name"
			assert.ErrorIs(t,
				d.stmts.UpdateTeam(t.Context(), team),
				new(database.NoRowFoundError),
			)
		})

		t.Run("name violates uniqueness constraint", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			teamID := uniqueTeamID(t)
			team := newTestTeam(projectID, teamID)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))

			taken := newTestTeam(projectID, teamID+"-taken")
			require.NoError(t, d.stmts.CreateTeam(t.Context(), taken))

			team.Name = taken.Name
			assert.ErrorIs(t,
				d.stmts.UpdateTeam(t.Context(), team),
				new(database.UniqueError),
			)

			// a case-only difference still collides.
			team.Name = strings.ToUpper(taken.Name)
			assert.ErrorIs(t,
				d.stmts.UpdateTeam(t.Context(), team),
				new(database.UniqueError),
			)
		})

		t.Run("unchanged name", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			team := newTestTeam(projectID, uniqueTeamID(t))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
			name := team.Name

			// The row already holds the name it is updated to, so the unique index
			// must not read it as a collision.
			require.NoError(t, d.stmts.UpdateTeam(t.Context(), team))
			assert.Equal(t, name, team.Name)
		})

		t.Run("same name in another project", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			team := newTestTeam(projectID, uniqueTeamID(t))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))

			otherProjectID := ensureProject(t, d.stmts)
			other := newTestTeam(otherProjectID, uniqueTeamID(t))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), other))

			other.Name = team.Name
			require.NoError(t, d.stmts.UpdateTeam(t.Context(), other))
			assert.Equal(t, team.Name, other.Name)
		})
	})
}

func TestTeamStatements_Deactivate(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		teamID := uniqueTeamID(t)
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))

		// DeactivateTeam opens its own withTransaction when called via pool.Statements().
		_, err := d.stmts.DeactivateTeam(t.Context(), projectID, teamID)
		require.NoError(t, err)

		stored, err := d.stmts.GetTeamByID(t.Context(), projectID, teamID)
		require.NoError(t, err)
		assert.Equal(t, domain.TeamStatusDeactivated, stored.Status)
	})
}

// Deactivation is idempotent: the team UPDATE is guarded on the active status,
// so a repeat leaves updated_at recording when the team was deactivated rather
// than when the last call arrived. Two concurrent deletes rely on the same
// predicate, which the loser re-evaluates after the winner commits.
func TestTeamStatements_Deactivate_RepeatDoesNotTouchUpdatedAt(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		teamID := uniqueTeamID(t)
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))

		_, err := d.stmts.DeactivateTeam(t.Context(), projectID, teamID)
		require.NoError(t, err)
		deactivated, err := d.stmts.GetTeamByID(t.Context(), projectID, teamID)
		require.NoError(t, err)

		_, err = d.stmts.DeactivateTeam(t.Context(), projectID, teamID)
		require.NoError(t, err)
		again, err := d.stmts.GetTeamByID(t.Context(), projectID, teamID)
		require.NoError(t, err)

		assert.Equal(t, domain.TeamStatusDeactivated, again.Status)
		assert.Equal(t, deactivated.UpdatedAt, again.UpdatedAt)
	})
}

// An id that names no team is not an error: delete reports success either way so
// it cannot be used to probe which team ids exist.
func TestTeamStatements_Deactivate_UnknownTeamIsNoOp(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		_, err := d.stmts.DeactivateTeam(t.Context(), projectID, "nonexistent")
		assert.NoError(t, err)
	})
}

// The project_id predicate is the tenant boundary: delete returns success for a
// team id belonging to another project, and must leave that team alone.
func TestTeamStatements_Deactivate_OtherProjectIsNoOp(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		ownerProjectID := ensureProject(t, d.stmts)
		teamID := uniqueTeamID(t)
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(ownerProjectID, teamID)))

		otherProjectID := ensureProject(t, d.stmts)
		_, err := d.stmts.DeactivateTeam(t.Context(), otherProjectID, teamID)
		require.NoError(t, err)

		stored, err := d.stmts.GetTeamByID(t.Context(), ownerProjectID, teamID)
		require.NoError(t, err)
		assert.Equal(t, domain.TeamStatusActive, stored.Status)
	})
}

func TestTeamStatements_Deactivate_CascadesMembershipsAndOwnedUsers(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		ownerTeamID, otherTeamID := uniqueTeamID(t), uniqueTeamID(t)
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, ownerTeamID)))
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, otherTeamID)))

		selfOwned := newTestUser(t, projectID, schemaURL, "usr-self-"+ownerTeamID, "self@example.com", "Self")
		require.NoError(t, d.stmts.CreateUser(t.Context(), selfOwned))
		teamOwned := newTestUser(t, projectID, schemaURL, "usr-owned-"+ownerTeamID, "owned@example.com", "Owned")
		teamOwned.LifecycleOwnerTeamID = &ownerTeamID
		require.NoError(t, d.stmts.CreateUser(t.Context(), teamOwned))

		memberships := []*domain.TeamMembership{
			{ProjectID: projectID, TeamID: ownerTeamID, UserID: selfOwned.ID, Status: domain.MembershipStatusActive},
			{ProjectID: projectID, TeamID: ownerTeamID, UserID: teamOwned.ID, Status: domain.MembershipStatusActive},
			// Deactivating the owner team reaches this one through the user, not the team.
			{ProjectID: projectID, TeamID: otherTeamID, UserID: teamOwned.ID, Status: domain.MembershipStatusActive},
		}
		for _, membership := range memberships {
			require.NoError(t, d.stmts.CreateTeamMembership(t.Context(), membership))
		}

		_, err := d.stmts.DeactivateTeam(t.Context(), projectID, ownerTeamID)
		require.NoError(t, err)

		userStatus := func(userID string) domain.UserStatus {
			user, err := d.stmts.GetUser(t.Context(),
				database.And(
					database.Equal(database.Col(domain.UserFieldProjectID), projectID),
					database.Equal(database.Col(domain.UserFieldID), userID),
				),
				service.UserQueryOptions{},
			)
			require.NoError(t, err)
			return user.Metadata.Status
		}
		assert.Equal(t, domain.UserStatusActive, userStatus(selfOwned.ID))
		assert.Equal(t, domain.UserStatusDeactivated, userStatus(teamOwned.ID))

		for _, membership := range memberships {
			stored, err := d.stmts.GetTeamMembership(t.Context(), projectID, membership.TeamID, membership.UserID)
			require.NoError(t, err)
			assert.Equal(t, domain.MembershipStatusRemoved, stored.Status,
				"membership team=%s user=%s", membership.TeamID, membership.UserID)
		}
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
		read, err := d.stmts.ListTeams(unfilteredListCtx(t), &database.ListOptions[domain.TeamField]{
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
			res, err := d.stmts.ListTeams(unfilteredListCtx(t), &database.ListOptions[domain.TeamField]{
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
			res, err := d.stmts.ListTeams(unfilteredListCtx(t), &database.ListOptions[domain.TeamField]{
				Filter: database.Equal(projectCol, otherProjectID),
			})
			require.NoError(t, err)
			assert.Equal(t, []string{otherTeam.ID}, teamIDs(res.Items))
		})

		t.Run("returns the stored team", func(t *testing.T) {
			res, err := d.stmts.ListTeams(unfilteredListCtx(t), &database.ListOptions[domain.TeamField]{
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
			_, err := d.stmts.DeactivateTeam(t.Context(), deactivatedProjectID, team.ID)
			require.NoError(t, err)

			res, err := d.stmts.ListTeams(unfilteredListCtx(t), &database.ListOptions[domain.TeamField]{
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

				first, err := d.stmts.ListTeams(unfilteredListCtx(t), &database.ListOptions[domain.TeamField]{Filter: onlyFixtures, Pagination: page})
				require.NoError(t, err)
				assert.Equal(t, []string{ids[0], ids[1]}, teamIDs(first.Items))
				require.NotEmpty(t, first.NextCursor)

				page.Cursor = first.NextCursor
				second, err := d.stmts.ListTeams(unfilteredListCtx(t), &database.ListOptions[domain.TeamField]{Filter: onlyFixtures, Pagination: page})
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

			first, err := d.stmts.ListTeams(unfilteredListCtx(t), &database.ListOptions[domain.TeamField]{Filter: filter, Pagination: page})
			require.NoError(t, err)
			assert.Equal(t, []string{ids[1]}, teamIDs(first.Items))
			require.NotEmpty(t, first.NextCursor)

			page.Cursor = first.NextCursor
			second, err := d.stmts.ListTeams(unfilteredListCtx(t), &database.ListOptions[domain.TeamField]{Filter: filter, Pagination: page})
			require.NoError(t, err)
			assert.Equal(t, []string{ids[2]}, teamIDs(second.Items))

			page.Cursor = second.NextCursor
			third, err := d.stmts.ListTeams(unfilteredListCtx(t), &database.ListOptions[domain.TeamField]{Filter: filter, Pagination: page})
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
