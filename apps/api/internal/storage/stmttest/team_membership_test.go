//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestTeamMembershipStatements_Get(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("returns_created_membership", func(t *testing.T) {
			projectID, schemaURL := ensureUserTestProject(t, d.stmts)
			teamID := "team-tm-" + uniqueSuffix(t)
			userID := "usr-tm-" + uniqueSuffix(t)

			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))
			require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Member")))

			membership := &domain.TeamMembership{
				ProjectID: projectID,
				TeamID:    teamID,
				UserID:    userID,
				Status:    domain.MembershipStatusActive,
			}
			require.NoError(t, d.stmts.CreateTeamMembership(t.Context(), membership))
			assert.False(t, membership.CreatedAt.IsZero())
			assert.False(t, membership.UpdatedAt.IsZero())

			got, err := d.stmts.GetTeamMembership(t.Context(), projectID, teamID, userID)
			require.NoError(t, err)
			assert.Equal(t, projectID, got.ProjectID)
			assert.Equal(t, teamID, got.TeamID)
			assert.Equal(t, userID, got.UserID)
			assert.Equal(t, domain.MembershipStatusActive, got.Status)
		})

		t.Run("missing_returns_NoRowFoundError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			_, err := d.stmts.GetTeamMembership(t.Context(), projectID, "missing-team", "missing-user")
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})

		t.Run("missing_user_returns_ForeignKeyError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			teamID := "team-tm-fk-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))

			err := d.stmts.CreateTeamMembership(t.Context(), &domain.TeamMembership{
				ProjectID: projectID,
				TeamID:    teamID,
				UserID:    "missing-user-" + uniqueSuffix(t),
				Status:    domain.MembershipStatusActive,
			})
			assert.ErrorIs(t, err, new(database.ForeignKeyError))
		})

		t.Run("list_by_user_and_team", func(t *testing.T) {
			projectID, schemaURL := ensureUserTestProject(t, d.stmts)
			teamID := "team-tm-list-" + uniqueSuffix(t)
			userID := "usr-tm-list-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))
			require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Member")))
			require.NoError(t, d.stmts.CreateTeamMembership(t.Context(), &domain.TeamMembership{
				ProjectID: projectID,
				TeamID:    teamID,
				UserID:    userID,
				Status:    domain.MembershipStatusActive,
			}))

			listedByUser, err := d.stmts.ListTeamMemberships(t.Context(), &database.ListOptions[domain.TeamMembershipField]{
				Filter: database.And(
					database.Equal(database.Col(domain.TeamMembershipFieldProjectID), projectID),
					database.Equal(database.Col(domain.TeamMembershipFieldUserID), userID),
				),
			})
			require.NoError(t, err)
			require.Len(t, listedByUser.Items, 1)
			assert.Equal(t, teamID, listedByUser.Items[0].TeamID)

			listedByTeam, err := d.stmts.ListTeamMemberships(t.Context(), &database.ListOptions[domain.TeamMembershipField]{
				Filter: database.And(
					database.Equal(database.Col(domain.TeamMembershipFieldProjectID), projectID),
					database.Equal(database.Col(domain.TeamMembershipFieldTeamID), teamID),
				),
			})
			require.NoError(t, err)
			require.Len(t, listedByTeam.Items, 1)
			assert.Equal(t, userID, listedByTeam.Items[0].UserID)

			empty, err := d.stmts.ListTeamMemberships(t.Context(), &database.ListOptions[domain.TeamMembershipField]{
				Filter: database.And(
					database.Equal(database.Col(domain.TeamMembershipFieldProjectID), projectID),
					database.Equal(database.Col(domain.TeamMembershipFieldUserID), "missing-user"),
				),
			})
			require.NoError(t, err)
			assert.Empty(t, empty.Items)
		})

		t.Run("update_status_and_not_found", func(t *testing.T) {
			projectID, schemaURL := ensureUserTestProject(t, d.stmts)
			teamID := "team-tm-upd-" + uniqueSuffix(t)
			userID := "usr-tm-upd-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))
			require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Member")))
			require.NoError(t, d.stmts.CreateTeamMembership(t.Context(), &domain.TeamMembership{
				ProjectID: projectID,
				TeamID:    teamID,
				UserID:    userID,
				Status:    domain.MembershipStatusActive,
			}))

			require.NoError(t, d.stmts.UpdateTeamMembershipStatus(t.Context(), projectID, teamID, userID, domain.MembershipStatusRemoved))
			updated, err := d.stmts.GetTeamMembership(t.Context(), projectID, teamID, userID)
			require.NoError(t, err)
			assert.Equal(t, domain.MembershipStatusRemoved, updated.Status)

			err = d.stmts.UpdateTeamMembershipStatus(t.Context(), projectID, "missing-team", "missing-user", domain.MembershipStatusInactive)
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})
	})
}

// TestTeamMembershipStatements_ListUserTeams pins the roster read every dialect
// owes `GET /users/{user_id}/teams`: the membership joined to its team so the
// name travels with the entry, filterable by status, and keyset-paginated.
func TestTeamMembershipStatements_ListUserTeams(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		suffix := uniqueSuffix(t)

		alphaTeam := newTestTeam(projectID, "team-alpha-"+suffix)
		alphaTeam.Name = "Alpha " + suffix
		betaTeam := newTestTeam(projectID, "team-beta-"+suffix)
		betaTeam.Name = "Beta " + suffix
		goneTeam := newTestTeam(projectID, "team-gone-"+suffix)
		goneTeam.Name = "Gone " + suffix
		for _, team := range []*domain.Team{alphaTeam, betaTeam, goneTeam} {
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
		}

		memberID := "user_roster-member-" + suffix
		require.NoError(t, d.stmts.CreateUser(t.Context(),
			newTestUser(t, projectID, schemaURL, memberID, "member-"+suffix+"@example.com", "Member")))
		// A second user on the same teams: the roster must stay scoped to one.
		otherID := "user_roster-other-" + suffix
		require.NoError(t, d.stmts.CreateUser(t.Context(),
			newTestUser(t, projectID, schemaURL, otherID, "other-"+suffix+"@example.com", "Other")))

		// Created in a fixed order so created_at ordering is deterministic.
		for _, membership := range []struct {
			teamID string
			userID string
			status domain.MembershipStatus
		}{
			{alphaTeam.ID, memberID, domain.MembershipStatusActive},
			{betaTeam.ID, memberID, domain.MembershipStatusPending},
			{goneTeam.ID, memberID, domain.MembershipStatusRemoved},
			{alphaTeam.ID, otherID, domain.MembershipStatusActive},
		} {
			require.NoError(t, d.stmts.CreateTeamMembership(t.Context(), &domain.TeamMembership{
				ProjectID: projectID,
				TeamID:    membership.teamID,
				UserID:    membership.userID,
				Status:    membership.status,
			}))
		}

		memberFilter := database.And(
			database.Equal(database.Col(domain.UserTeamFieldProjectID), projectID),
			database.Equal(database.Col(domain.UserTeamFieldUserID), memberID),
		)
		byTeamID := database.OrderBy[domain.UserTeamField]{
			Columns:   []database.Column[domain.UserTeamField]{database.Col(domain.UserTeamFieldTeamID)},
			Direction: database.OrderAsc,
		}

		t.Run("joins_the_team_name_and_scopes_to_the_user", func(t *testing.T) {
			list, err := d.stmts.ListUserTeams(t.Context(), &database.ListOptions[domain.UserTeamField]{
				Filter:     memberFilter,
				Pagination: database.Page[domain.UserTeamField]{OrderBy: byTeamID},
			})
			require.NoError(t, err)
			require.Len(t, list.Items, 3, "every membership is readable; status filtering is the caller's call")

			alpha := list.Items[0]
			assert.Equal(t, projectID, alpha.ProjectID)
			assert.Equal(t, memberID, alpha.UserID)
			assert.Equal(t, alphaTeam.ID, alpha.TeamID)
			assert.Equal(t, alphaTeam.Name, alpha.TeamName, "the team name travels with the roster entry")
			assert.Equal(t, domain.MembershipStatusActive, alpha.Status)
			assert.False(t, alpha.CreatedAt.IsZero())
			assert.False(t, alpha.UpdatedAt.Before(alpha.CreatedAt))

			assert.Equal(t, []string{alphaTeam.ID, betaTeam.ID, goneTeam.ID}, userTeamIDs(list.Items))
		})

		t.Run("filters_by_membership_status", func(t *testing.T) {
			onRoster := make([]database.Filter[domain.UserTeamField], 0, len(domain.RosterMembershipStatuses))
			for _, status := range domain.RosterMembershipStatuses {
				onRoster = append(onRoster, database.Equal(database.Col(domain.UserTeamFieldStatus), status.String()))
			}
			list, err := d.stmts.ListUserTeams(t.Context(), &database.ListOptions[domain.UserTeamField]{
				Filter:     database.And(memberFilter, database.Or(onRoster...)),
				Pagination: database.Page[domain.UserTeamField]{OrderBy: byTeamID},
			})
			require.NoError(t, err)
			assert.Equal(t, []string{alphaTeam.ID, betaTeam.ID}, userTeamIDs(list.Items),
				"the removed membership is history, not roster")
		})

		t.Run("paginates_by_cursor", func(t *testing.T) {
			page := database.Page[domain.UserTeamField]{Limit: 1, OrderBy: byTeamID}
			first, err := d.stmts.ListUserTeams(t.Context(), &database.ListOptions[domain.UserTeamField]{
				Filter:     memberFilter,
				Pagination: page,
			})
			require.NoError(t, err)
			require.Equal(t, []string{alphaTeam.ID}, userTeamIDs(first.Items))
			require.NotEmpty(t, first.NextCursor, "a full page carries a cursor")

			page.Cursor = first.NextCursor
			second, err := d.stmts.ListUserTeams(t.Context(), &database.ListOptions[domain.UserTeamField]{
				Filter:     memberFilter,
				Pagination: page,
			})
			require.NoError(t, err)
			assert.Equal(t, []string{betaTeam.ID}, userTeamIDs(second.Items))
		})

		t.Run("empty_for_a_user_on_no_roster", func(t *testing.T) {
			loneID := "user_roster-lone-" + suffix
			require.NoError(t, d.stmts.CreateUser(t.Context(),
				newTestUser(t, projectID, schemaURL, loneID, "lone-"+suffix+"@example.com", "Lone")))

			list, err := d.stmts.ListUserTeams(t.Context(), &database.ListOptions[domain.UserTeamField]{
				Filter: database.And(
					database.Equal(database.Col(domain.UserTeamFieldProjectID), projectID),
					database.Equal(database.Col(domain.UserTeamFieldUserID), loneID),
				),
			})
			require.NoError(t, err)
			assert.Empty(t, list.Items)
		})
	})
}

func userTeamIDs(teams []*domain.UserTeam) []string {
	ids := make([]string, len(teams))
	for i, team := range teams {
		ids[i] = team.TeamID
	}
	return ids
}
