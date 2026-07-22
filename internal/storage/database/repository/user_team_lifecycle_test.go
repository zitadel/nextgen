//go:build postgres_integration || spanner_integration

package repository_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func setupLifecycleFixture(t *testing.T, tx database.Transaction, projectID string) *repository.TeamRepository {
	t.Helper()
	ensureProject(t, tx, projectID)
	return repository.NewTeamRepository(tx)
}

func createTeam(t *testing.T, tx database.Transaction, teamRepo *repository.TeamRepository, projectID, teamID string) {
	t.Helper()
	require.NoError(t, teamRepo.Create(t.Context(), tx, &domain.Team{ProjectID: projectID, ID: teamID}))
}

func createLifecycleUser(t *testing.T, tx database.Transaction, projectID, schemaURL, userID string, lifecycleOwner, participation *string) {
	t.Helper()
	if participation != nil && *participation != "" {
		ensureTeam(t, tx, projectID, *participation)
	}
	if lifecycleOwner != nil && *lifecycleOwner != "" {
		ensureTeam(t, tx, projectID, *lifecycleOwner)
	}
	ensureJSONSchemaRow(t, tx, projectID, schemaURL, []byte("{}"))
	ctx := t.Context()
	_, err := tx.Exec(ctx,
		`INSERT INTO zitadel_nextgen.users (project_id, schema_url, id, lifecycle_owner_team_id, status)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (project_id, id) DO NOTHING`,
		projectID, schemaURL, userID, lifecycleOwner, domain.UserStatusActive.String(),
	)
	require.NoError(t, err)
	if participation != nil && *participation != "" {
		membershipRepo := repository.NewTeamMembershipRepository(tx)
		require.NoError(t, membershipRepo.Create(ctx, tx, &domain.TeamMembership{
			ProjectID: projectID,
			TeamID:    *participation,
			UserID:    userID,
			Status:    domain.MembershipStatusActive,
		}))
	}
	attrVal, err := json.Marshal(userID)
	require.NoError(t, err)
	teamScope := ""
	if participation != nil {
		teamScope = *participation
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO zitadel_nextgen.user_attributes (project_id, team_id, user_id, key, value)
		 VALUES ($1, $2, $3, 'nickname', $4::jsonb)
		 ON CONFLICT DO NOTHING`,
		projectID, teamScope, userID, attrVal,
	)
	require.NoError(t, err)
}

func getUserStatus(t *testing.T, tx database.Transaction, projectID, userID string) (domain.UserStatus, *string) {
	t.Helper()
	var status string
	var lifecycleOwner database.Null[string]
	err := tx.QueryRow(t.Context(),
		`SELECT status, lifecycle_owner_team_id FROM zitadel_nextgen.users WHERE project_id = $1 AND id = $2`,
		projectID, userID,
	).Scan(&status, &lifecycleOwner)
	require.NoError(t, err)
	var owner *string
	if lifecycleOwner.Valid {
		v := lifecycleOwner.V
		owner = &v
	}
	return domain.UserStatus(status), owner
}

func deleteLifecycleUser(t *testing.T, tx database.Transaction, projectID, userID string) {
	t.Helper()
	deleteUser(t, tx, projectID, userID)
}

// Acceptance signal 1: self-owned user survives team deactivation.
func TestUserTeamLifecycle_SelfOwnedUserSurvivesTeamDeactivation(t *testing.T) {
	skipIfSpanner(t)
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	const (
		pid       = "proj-lifecycle-self-owned"
		teamID    = "team-lifecycle-self"
		userID    = "usr-lifecycle-self"
		schemaURL = "https://schemas.test/lifecycle-self/v1.json"
	)

	teamRepo := setupLifecycleFixture(t, tx, pid)
	createTeam(t, tx, teamRepo, pid, teamID)

	participation := teamID
	createLifecycleUser(t, tx, pid, schemaURL, userID, nil, &participation)

	require.NoError(t, teamRepo.Deactivate(ctx, tx, pid, teamID))

	status, owner := getUserStatus(t, tx, pid, userID)
	require.Nil(t, owner)
	require.Equal(t, domain.UserStatusActive, status)

	team, err := teamRepo.Get(ctx, tx, pid, teamID)
	require.NoError(t, err)
	require.Equal(t, domain.TeamStatusDeactivated, team.Status)
}

// Acceptance signal 2: team-owned user is deactivated (not hard-deleted) when owning team is deactivated.
func TestUserTeamLifecycle_TeamOwnedUserDeactivatedOnTeamDeactivation(t *testing.T) {
	skipIfSpanner(t)
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	const (
		pid       = "proj-lifecycle-team-owned"
		teamID    = "team-lifecycle-owned"
		userID    = "usr-lifecycle-owned"
		schemaURL = "https://schemas.test/lifecycle-owned/v1.json"
	)

	teamRepo := setupLifecycleFixture(t, tx, pid)
	createTeam(t, tx, teamRepo, pid, teamID)

	owner := teamID
	participation := teamID
	createLifecycleUser(t, tx, pid, schemaURL, userID, &owner, &participation)

	require.NoError(t, teamRepo.Deactivate(ctx, tx, pid, teamID))

	status, gotOwner := getUserStatus(t, tx, pid, userID)
	require.NotNil(t, gotOwner)
	require.Equal(t, owner, *gotOwner)
	require.Equal(t, domain.UserStatusDeactivated, status)
}

// Team-owned users deactivated via TeamRepository.Deactivate lose memberships on all teams
// (same roster policy as UserStatements.DeactivateUser / ADR 024).
func TestUserTeamLifecycle_TeamOwnedUserLosesAllMembershipsOnOwningTeamDeactivation(t *testing.T) {
	skipIfSpanner(t)
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	const (
		pid         = "proj-lifecycle-cross-team"
		ownerTeamID = "team-lifecycle-owner"
		otherTeamID = "team-lifecycle-other"
		userID      = "usr-lifecycle-cross"
		schemaURL   = "https://schemas.test/lifecycle-cross/v1.json"
	)

	teamRepo := setupLifecycleFixture(t, tx, pid)
	createTeam(t, tx, teamRepo, pid, ownerTeamID)
	createTeam(t, tx, teamRepo, pid, otherTeamID)

	owner := ownerTeamID
	participation := ownerTeamID
	createLifecycleUser(t, tx, pid, schemaURL, userID, &owner, &participation)

	membershipRepo := repository.NewTeamMembershipRepository(tx)
	require.NoError(t, membershipRepo.Create(ctx, tx, &domain.TeamMembership{
		ProjectID: pid,
		TeamID:    otherTeamID,
		UserID:    userID,
		Status:    domain.MembershipStatusActive,
	}))

	require.NoError(t, teamRepo.Deactivate(ctx, tx, pid, ownerTeamID))

	status, _ := getUserStatus(t, tx, pid, userID)
	require.Equal(t, domain.UserStatusDeactivated, status)

	for _, teamID := range []string{ownerTeamID, otherTeamID} {
		membership, err := membershipRepo.Get(ctx, tx, pid, teamID, userID)
		require.NoError(t, err)
		require.Equal(t, domain.MembershipStatusRemoved, membership.Status, "team %s", teamID)
	}
}

// Acceptance signal 3: deleting a user does not cascade-delete teams they participate in.
func TestUserTeamLifecycle_UserDeleteDoesNotRemoveTeams(t *testing.T) {
	skipIfSpanner(t)
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	const (
		pid       = "proj-lifecycle-user-delete"
		teamID    = "team-lifecycle-creator"
		userID    = "usr-lifecycle-creator"
		schemaURL = "https://schemas.test/lifecycle-delete/v1.json"
	)

	teamRepo := setupLifecycleFixture(t, tx, pid)
	createTeam(t, tx, teamRepo, pid, teamID)

	participation := teamID
	createLifecycleUser(t, tx, pid, schemaURL, userID, nil, &participation)

	deleteLifecycleUser(t, tx, pid, userID)

	team, err := teamRepo.Get(ctx, tx, pid, teamID)
	require.NoError(t, err)
	require.Equal(t, teamID, team.ID)
}

// Acceptance signal 4: no ON DELETE CASCADE on the user/team graph.
func TestUserTeamLifecycle_NoCascadeOnUserTeamGraph(t *testing.T) {
	skipIfSpanner(t)
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	const query = `
SELECT c.conname
FROM pg_constraint c
JOIN pg_class child ON c.conrelid = child.oid
JOIN pg_class parent ON c.confrelid = parent.oid
JOIN pg_namespace n ON child.relnamespace = n.oid
WHERE n.nspname = 'zitadel_nextgen'
  AND c.contype = 'f'
  AND child.relname IN ('users', 'teams', 'team_memberships')
  AND parent.relname IN ('users', 'teams', 'team_memberships')
  AND c.confdeltype = 'c'`

	rows, err := tx.Query(ctx, query)
	require.NoError(t, err)
	defer rows.Close()

	var cascades []string
	for rows.Next() {
		var name string
		require.NoError(t, rows.Scan(&name))
		cascades = append(cascades, name)
	}
	require.NoError(t, rows.Err())
	require.Empty(t, cascades, "user/team graph must not use ON DELETE CASCADE: %v", cascades)
}
