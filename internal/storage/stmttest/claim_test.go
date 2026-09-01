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
			_, err = d.stmts.DeactivateTeam(t.Context(), projectID, teamA)
			require.NoError(t, err)
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

// TestClaimStatements_GetEarliestTeamMembership pins the other half of the
// personal-team resolution (#527). GetPersonalTeamForUser answers "may this
// user claim" and so collapses "holds no membership" and "personal team is
// deactivated" into one NoRowFoundError. Provisioning has to tell those apart,
// because the first needs a team created and the second must be left alone, so
// it asks this question instead: the same earliest pick, no active filters.
func TestClaimStatements_GetEarliestTeamMembership(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("no membership at all is not-found", func(t *testing.T) {
			projectID, schemaURL := ensureUserTestProject(t, d.stmts)
			userID := "usr-em-none-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "NoTeam")))

			_, err := d.stmts.GetEarliestTeamMembership(t.Context(), projectID, userID)
			assert.ErrorIs(t, err, new(database.NoRowFoundError),
				"only a user with no membership at all may be provisioned a team")
		})

		t.Run("deactivated earliest membership is returned, not hidden", func(t *testing.T) {
			// The distinction the split exists for: GetPersonalTeamForUser
			// reports not-found here (pinned above by non_active_membership_excluded),
			// so provisioning would read that as "no team" and mint a second one.
			projectID, schemaURL := ensureUserTestProject(t, d.stmts)
			userID := "usr-em-removed-" + uniqueSuffix(t)
			teamID := addActiveMembership(t, d.stmts, projectID, schemaURL, "team-em-removed-"+uniqueSuffix(t), userID)
			require.NoError(t, d.stmts.UpdateTeamMembershipStatus(t.Context(), projectID, teamID, userID, domain.MembershipStatusRemoved))

			_, err := d.stmts.GetPersonalTeamForUser(t.Context(), projectID, userID)
			require.ErrorIs(t, err, new(database.NoRowFoundError), "claim still refuses the deactivated team")

			got, err := d.stmts.GetEarliestTeamMembership(t.Context(), projectID, userID)
			require.NoError(t, err, "provisioning must still see the membership")
			assert.Equal(t, teamID, got.TeamID)
			assert.Equal(t, domain.MembershipStatusRemoved, got.Status)
		})

		t.Run("deactivated earliest team is returned, not hidden", func(t *testing.T) {
			projectID, schemaURL := ensureUserTestProject(t, d.stmts)
			userID := "usr-em-deacteam-" + uniqueSuffix(t)
			teamID := addActiveMembership(t, d.stmts, projectID, schemaURL, "team-em-deac-"+uniqueSuffix(t), userID)
			_, err := d.stmts.DeactivateTeam(t.Context(), projectID, teamID)
			require.NoError(t, err)

			_, err = d.stmts.GetPersonalTeamForUser(t.Context(), projectID, userID)
			require.ErrorIs(t, err, new(database.NoRowFoundError))

			got, err := d.stmts.GetEarliestTeamMembership(t.Context(), projectID, userID)
			require.NoError(t, err, "the membership row survives its team's deactivation")
			assert.Equal(t, teamID, got.TeamID)
		})

		t.Run("picks the earliest membership, never a later one", func(t *testing.T) {
			projectID, schemaURL := ensureUserTestProject(t, d.stmts)
			userID := "usr-em-earliest-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Earliest")))

			teamA := "team-em-a-" + uniqueSuffix(t)
			teamB := "team-em-b-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamA)))
			require.NoError(t, d.stmts.CreateTeamMembership(t.Context(), &domain.TeamMembership{
				ProjectID: projectID, TeamID: teamA, UserID: userID, Status: domain.MembershipStatusActive,
			}))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamB)))
			require.NoError(t, d.stmts.CreateTeamMembership(t.Context(), &domain.TeamMembership{
				ProjectID: projectID, TeamID: teamB, UserID: userID, Status: domain.MembershipStatusActive,
			}))

			got, err := d.stmts.GetEarliestTeamMembership(t.Context(), projectID, userID)
			require.NoError(t, err)
			assert.Equal(t, teamA, got.TeamID, "must agree with GetPersonalTeamForUser on which membership is earliest")

			// And it keeps agreeing once the earliest is removed: the same row
			// comes back, now carrying the status that explains claim's refusal.
			require.NoError(t, d.stmts.UpdateTeamMembershipStatus(t.Context(), projectID, teamA, userID, domain.MembershipStatusRemoved))
			got, err = d.stmts.GetEarliestTeamMembership(t.Context(), projectID, userID)
			require.NoError(t, err)
			assert.Equal(t, teamA, got.TeamID, "no fallback to the later active membership")
			assert.Equal(t, domain.MembershipStatusRemoved, got.Status)
		})
	})
}

// TestClaimStatements_OwningTeamGrant pins the claim source of truth
// (ADR 046 / ADR 054 §2): the active owning-team grant answers claimed-ness,
// export visibility lists it, and the DB keeps it unique per project on every
// dialect (partial index on Postgres/SQLite, NULL_FILTERED owning_team_key
// index on Spanner).
func TestClaimStatements_OwningTeamGrant(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("grant round-trip and revoke", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)

			_, err := d.stmts.GetActiveOwningTeamGrant(t.Context(), projectID)
			assert.ErrorIs(t, err, new(database.NoRowFoundError), "unclaimed project has no grant")

			teamID := "team-own-" + uniqueSuffix(t)
			asgn := domain.NewClaimTeamAssignment(projectID, teamID)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), asgn))

			grant, err := d.stmts.GetActiveOwningTeamGrant(t.Context(), projectID)
			require.NoError(t, err)
			assert.Equal(t, teamID, grant.PrincipalID)
			assert.Equal(t, domain.AuthzPrincipalTypeTeam, grant.PrincipalType)

			require.NoError(t, d.stmts.RevokeAuthzAssignment(t.Context(), projectID, asgn.ID))
			_, err = d.stmts.GetActiveOwningTeamGrant(t.Context(), projectID)
			assert.ErrorIs(t, err, new(database.NoRowFoundError), "revoked grant no longer claims")
		})

		t.Run("owning grant with expiry rejected", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			asgn := domain.NewClaimTeamAssignment(projectID, "team-exp-"+uniqueSuffix(t))
			expiresAt := time.Now().Add(time.Hour)
			asgn.ExpiresAt = &expiresAt
			assert.ErrorIs(t, d.stmts.CreateAuthzAssignment(t.Context(), asgn), new(database.CheckError),
				"an expiring owning-team grant must fail the schema CHECK (ADR 054 §2)")
		})

		t.Run("one active owning team per project", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				domain.NewClaimTeamAssignment(projectID, "team-a-"+uniqueSuffix(t))))

			err := d.stmts.CreateAuthzAssignment(t.Context(),
				domain.NewClaimTeamAssignment(projectID, "team-b-"+uniqueSuffix(t)))
			assert.ErrorIs(t, err, new(database.UniqueError),
				"a second active owning-team grant must conflict (ADR 054 §2)")
		})

		t.Run("list claimed project ids", func(t *testing.T) {
			claimed := ensureProject(t, d.stmts)
			unclaimed := ensureProject(t, d.stmts)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				domain.NewClaimTeamAssignment(claimed, "team-claim-"+uniqueSuffix(t))))

			ids, err := d.stmts.ListClaimedProjectIDs(t.Context(), "", 500)
			require.NoError(t, err)
			assert.Contains(t, ids, claimed)
			assert.NotContains(t, ids, unclaimed)
		})
	})
}
