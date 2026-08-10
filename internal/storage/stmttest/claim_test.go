//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func newTestChallenge(t *testing.T, projectID string) *domain.ClaimChallenge {
	t.Helper()
	challenge, err := domain.NewClaimChallenge(
		"chal-"+uniqueSuffix(t),
		projectID,
		"secret-"+uniqueSuffix(t),
		time.Now().Add(time.Hour),
	)
	require.NoError(t, err)
	return challenge
}

func TestClaimStatements_CreateChallenge(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("round_trips_fields_and_sets_created_at", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			challenge := newTestChallenge(t, projectID)

			require.NoError(t, d.stmts.CreateChallenge(t.Context(), challenge))
			assert.False(t, challenge.CreatedAt.IsZero())

			got, err := d.stmts.GetChallengeByID(t.Context(), projectID, challenge.ID)
			require.NoError(t, err)
			assert.Equal(t, challenge.ID, got.ID)
			assert.Equal(t, projectID, got.ProjectID)
			assert.Equal(t, challenge.InitiatingSecretHash, got.InitiatingSecretHash)
			assert.Equal(t, domain.ClaimChallengeStatusPending, got.Status)
			assert.WithinDuration(t, challenge.ExpiresAt, got.ExpiresAt, time.Second)
			assert.False(t, got.CreatedAt.IsZero())
		})

		t.Run("duplicate_id_returns_UniqueError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			challenge := newTestChallenge(t, projectID)
			require.NoError(t, d.stmts.CreateChallenge(t.Context(), challenge))

			dup := newTestChallenge(t, projectID)
			dup.ID = challenge.ID
			err := d.stmts.CreateChallenge(t.Context(), dup)
			assert.ErrorIs(t, err, new(database.UniqueError))
		})

		t.Run("unknown_project_returns_ForeignKeyError", func(t *testing.T) {
			challenge := newTestChallenge(t, "missing-project-"+uniqueSuffix(t))
			err := d.stmts.CreateChallenge(t.Context(), challenge)
			assert.ErrorIs(t, err, new(database.ForeignKeyError))
		})
	})
}

func TestClaimStatements_GetChallengeByID(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("absent_returns_NoRowFoundError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			_, err := d.stmts.GetChallengeByID(t.Context(), projectID, "missing-challenge-"+uniqueSuffix(t))
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})

		t.Run("wrong_project_returns_NoRowFoundError", func(t *testing.T) {
			projectA := ensureProject(t, d.stmts)
			projectB := ensureProject(t, d.stmts)
			challenge := newTestChallenge(t, projectA)
			require.NoError(t, d.stmts.CreateChallenge(t.Context(), challenge))

			_, err := d.stmts.GetChallengeByID(t.Context(), projectB, challenge.ID)
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})
	})
}

func TestClaimStatements_MarkChallengeCompleted(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("pending_becomes_completed", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			challenge := newTestChallenge(t, projectID)
			require.NoError(t, d.stmts.CreateChallenge(t.Context(), challenge))

			require.NoError(t, d.stmts.MarkChallengeCompleted(t.Context(), projectID, challenge.ID))

			got, err := d.stmts.GetChallengeByID(t.Context(), projectID, challenge.ID)
			require.NoError(t, err)
			assert.Equal(t, domain.ClaimChallengeStatusCompleted, got.Status)
		})

		t.Run("second_completion_returns_NoRowFoundError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			challenge := newTestChallenge(t, projectID)
			require.NoError(t, d.stmts.CreateChallenge(t.Context(), challenge))

			require.NoError(t, d.stmts.MarkChallengeCompleted(t.Context(), projectID, challenge.ID))
			err := d.stmts.MarkChallengeCompleted(t.Context(), projectID, challenge.ID)
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})

		t.Run("absent_returns_NoRowFoundError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			err := d.stmts.MarkChallengeCompleted(t.Context(), projectID, "missing-challenge-"+uniqueSuffix(t))
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})

		t.Run("wrong_project_returns_NoRowFoundError", func(t *testing.T) {
			projectA := ensureProject(t, d.stmts)
			projectB := ensureProject(t, d.stmts)
			challenge := newTestChallenge(t, projectA)
			require.NoError(t, d.stmts.CreateChallenge(t.Context(), challenge))

			err := d.stmts.MarkChallengeCompleted(t.Context(), projectB, challenge.ID)
			assert.ErrorIs(t, err, new(database.NoRowFoundError))

			// The challenge stays pending: the guard did not touch another project's row.
			got, err := d.stmts.GetChallengeByID(t.Context(), projectA, challenge.ID)
			require.NoError(t, err)
			assert.Equal(t, domain.ClaimChallengeStatusPending, got.Status)
		})
	})
}

// addActiveMembership creates a team, a user, and an active membership binding
// the user to that team, returning the team ID.
func addActiveMembership(t *testing.T, stmts service.AllStatements, projectID, schemaURL, teamID, userID string) string {
	t.Helper()
	require.NoError(t, stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))
	require.NoError(t, stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Member")))
	require.NoError(t, stmts.CreateTeamMembership(t.Context(), &domain.TeamMembership{
		ProjectID: projectID,
		TeamID:    teamID,
		UserID:    userID,
		Status:    domain.MembershipStatusActive,
	}))
	return teamID
}

func TestClaimStatements_GetPersonalTeamForUser(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("single_active_membership_returns_team", func(t *testing.T) {
			projectID, schemaURL := ensureUserTestProject(t, d.stmts)
			userID := "usr-pt-" + uniqueSuffix(t)
			teamID := addActiveMembership(t, d.stmts, projectID, schemaURL, "team-pt-"+uniqueSuffix(t), userID)

			got, err := d.stmts.GetPersonalTeamForUser(t.Context(), projectID, userID)
			require.NoError(t, err)
			assert.Equal(t, teamID, got.ID)
			assert.Equal(t, projectID, got.ProjectID)
			assert.Equal(t, domain.TeamStatusActive, got.Status)
		})

		t.Run("no_membership_returns_NoRowFoundError", func(t *testing.T) {
			projectID, schemaURL := ensureUserTestProject(t, d.stmts)
			userID := "usr-pt-none-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Loner")))

			_, err := d.stmts.GetPersonalTeamForUser(t.Context(), projectID, userID)
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})

		t.Run("multiple_memberships_earliest_wins", func(t *testing.T) {
			projectID, schemaURL := ensureUserTestProject(t, d.stmts)
			userID := "usr-pt-multi-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Multi")))

			// team-a is created (and joined) first, so it is the earliest membership;
			// its id also sorts before team-b, so the created_at, team_id tiebreak agrees.
			teamA := "team-a-" + uniqueSuffix(t)
			teamB := "team-b-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamA)))
			require.NoError(t, d.stmts.CreateTeamMembership(t.Context(), &domain.TeamMembership{
				ProjectID: projectID, TeamID: teamA, UserID: userID, Status: domain.MembershipStatusActive,
			}))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamB)))
			require.NoError(t, d.stmts.CreateTeamMembership(t.Context(), &domain.TeamMembership{
				ProjectID: projectID, TeamID: teamB, UserID: userID, Status: domain.MembershipStatusActive,
			}))

			got, err := d.stmts.GetPersonalTeamForUser(t.Context(), projectID, userID)
			require.NoError(t, err)
			assert.Equal(t, teamA, got.ID)

			// Deactivating the earliest team must NOT fall back to the next active
			// team: the earliest membership is selected unconditionally, so once its
			// team is inactive the resolve returns not-found rather than teamB.
			require.NoError(t, d.stmts.DeactivateTeam(t.Context(), projectID, teamA))
			_, err = d.stmts.GetPersonalTeamForUser(t.Context(), projectID, userID)
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})

		t.Run("non_active_membership_excluded", func(t *testing.T) {
			projectID, schemaURL := ensureUserTestProject(t, d.stmts)
			userID := "usr-pt-inactive-" + uniqueSuffix(t)
			teamID := addActiveMembership(t, d.stmts, projectID, schemaURL, "team-pt-inactive-"+uniqueSuffix(t), userID)

			// Flip the (only) membership to removed while its team stays active: the
			// m.status = 'active' filter must now exclude it.
			require.NoError(t, d.stmts.UpdateTeamMembershipStatus(t.Context(), projectID, teamID, userID, domain.MembershipStatusRemoved))

			_, err := d.stmts.GetPersonalTeamForUser(t.Context(), projectID, userID)
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})

		t.Run("removed_earliest_membership_does_not_fall_back", func(t *testing.T) {
			projectID, schemaURL := ensureUserTestProject(t, d.stmts)
			userID := "usr-pt-nofallback-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "NoFallback")))

			// team-a is joined first (earliest membership); team-b is a later
			// membership on another team that stays fully active.
			teamA := "team-a-" + uniqueSuffix(t)
			teamB := "team-b-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamA)))
			require.NoError(t, d.stmts.CreateTeamMembership(t.Context(), &domain.TeamMembership{
				ProjectID: projectID, TeamID: teamA, UserID: userID, Status: domain.MembershipStatusActive,
			}))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamB)))
			require.NoError(t, d.stmts.CreateTeamMembership(t.Context(), &domain.TeamMembership{
				ProjectID: projectID, TeamID: teamB, UserID: userID, Status: domain.MembershipStatusActive,
			}))

			// Flip only the earliest membership to removed; team-a itself stays
			// active and team-b's membership stays active. The earliest membership
			// is still the one selected, so an inactive membership alone (with no
			// team deactivation) yields not-found without falling back to team-b.
			require.NoError(t, d.stmts.UpdateTeamMembershipStatus(t.Context(), projectID, teamA, userID, domain.MembershipStatusRemoved))

			_, err := d.stmts.GetPersonalTeamForUser(t.Context(), projectID, userID)
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})
	})
}
