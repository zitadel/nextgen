//go:build postgres_integration || spanner_integration

package repository_test

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func setupLifecycleFixture(t *testing.T, tx database.Transaction, projectID string) (teamRepo *repository.TeamRepository, userRepo *repository.UserRepository) {
	t.Helper()
	ensureProject(t, tx, projectID)
	teamRepo = repository.NewTeamRepository(tx)
	userRepo = repository.NewUserRepository()
	return teamRepo, userRepo
}

func createTeam(t *testing.T, tx database.Transaction, teamRepo *repository.TeamRepository, projectID, teamID string) {
	t.Helper()
	require.NoError(t, teamRepo.Create(t.Context(), tx, &domain.Team{ProjectID: projectID, ID: teamID}))
}

func createLifecycleUser(t *testing.T, tx database.Transaction, userRepo *repository.UserRepository, projectID, schemaURL, userID string, lifecycleOwner, participation *string) {
	t.Helper()
	if participation != nil && *participation != "" {
		ensureTeam(t, tx, projectID, *participation)
	}
	if lifecycleOwner != nil && *lifecycleOwner != "" {
		ensureTeam(t, tx, projectID, *lifecycleOwner)
	}
	ensureJSONSchemaRow(t, tx, projectID, schemaURL, []byte("{}"))
	attr, err := domain.NewCreateAttribute("nickname", userID, domain.AttributeUniquenessUnspecified)
	require.NoError(t, err)
	require.NoError(t, userRepo.Create(t.Context(), tx, &domain.CreateUser{
		ProjectID:            projectID,
		SchemaURL:            schemaURL,
		ID:                   userID,
		LifecycleOwnerTeamID: lifecycleOwner,
		InitialMembershipTeamID:  participation,
		Attributes:           []*domain.CreateAttribute{attr},
	}))
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

	teamRepo, userRepo := setupLifecycleFixture(t, tx, pid)
	createTeam(t, tx, teamRepo, pid, teamID)

	participation := teamID
	createLifecycleUser(t, tx, userRepo, pid, schemaURL, userID, nil, &participation)

	require.NoError(t, teamRepo.Deactivate(ctx, tx, pid, teamID))

	got, err := userRepo.Get(ctx, tx, database.WithCondition(userRepo.PrimaryKeyCondition(pid, userID)))
	require.NoError(t, err)
	require.True(t, got.IsSelfOwned())
	require.Equal(t, domain.UserStatusActive, got.Status)

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

	teamRepo, userRepo := setupLifecycleFixture(t, tx, pid)
	createTeam(t, tx, teamRepo, pid, teamID)

	owner := teamID
	participation := teamID
	createLifecycleUser(t, tx, userRepo, pid, schemaURL, userID, &owner, &participation)

	require.NoError(t, teamRepo.Deactivate(ctx, tx, pid, teamID))

	got, err := userRepo.Get(ctx, tx, database.WithCondition(userRepo.PrimaryKeyCondition(pid, userID)))
	require.NoError(t, err)
	require.True(t, got.IsTeamOwned())
	require.Equal(t, domain.UserStatusDeactivated, got.Status)
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

	teamRepo, userRepo := setupLifecycleFixture(t, tx, pid)
	createTeam(t, tx, teamRepo, pid, teamID)

	participation := teamID
	createLifecycleUser(t, tx, userRepo, pid, schemaURL, userID, nil, &participation)

	require.NoError(t, userRepo.Delete(ctx, tx, userRepo.PrimaryKeyCondition(pid, userID)))

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

func TestUserRepository_DeactivateRemovesMemberships(t *testing.T) {
	skipIfSpanner(t)
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	const (
		pid       = "proj-user-deactivate"
		teamID    = "team-user-deactivate"
		userID    = "usr-user-deactivate"
		schemaURL = "https://schemas.test/user-deactivate/v1.json"
	)

	teamRepo, userRepo := setupLifecycleFixture(t, tx, pid)
	createTeam(t, tx, teamRepo, pid, teamID)

	participation := teamID
	createLifecycleUser(t, tx, userRepo, pid, schemaURL, userID, nil, &participation)

	require.NoError(t, userRepo.Deactivate(ctx, tx, pid, userID))

	got, err := userRepo.Get(ctx, tx, database.WithCondition(userRepo.PrimaryKeyCondition(pid, userID)))
	require.NoError(t, err)
	require.Equal(t, domain.UserStatusDeactivated, got.Status)

	membershipRepo := repository.NewTeamMembershipRepository(tx)
	membership, err := membershipRepo.Get(ctx, tx, pid, teamID, userID)
	require.NoError(t, err)
	require.Equal(t, domain.MembershipStatusRemoved, membership.Status)

	_, err = teamRepo.Get(ctx, tx, pid, teamID)
	require.NoError(t, err, fmt.Sprintf("team %s should still exist after user deactivation", teamID))
}
