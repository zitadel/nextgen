//go:build postgres_integration || spanner_integration

package repository_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func setupLifecycleFixture(t *testing.T, tx database.Transaction, projectID string) *repository.UserRepository {
	t.Helper()
	ensureProject(t, tx, projectID)
	return repository.NewUserRepository()
}

func getTeam(t *testing.T, tx database.QueryExecutor, projectID, id string) *domain.Team {
	t.Helper()
	ctx := t.Context()
	var (
		status    string
		createdAt time.Time
		updatedAt time.Time
	)
	query := `SELECT project_id, id, status, created_at, updated_at FROM zitadel_nextgen.teams WHERE project_id = $1 AND id = $2`
	if isSpannerDB {
		query = `SELECT project_id, id, status, created_at, updated_at FROM teams WHERE project_id = $1 AND id = $2`
	}
	row := tx.QueryRow(ctx, query, projectID, id)
	var gotProjectID, gotID string
	require.NoError(t, row.Scan(&gotProjectID, &gotID, &status, &createdAt, &updatedAt))
	return &domain.Team{
		ProjectID: gotProjectID,
		ID:        gotID,
		Status:    domain.TeamStatus(status),
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}
}

func deactivateTeam(t *testing.T, tx database.QueryExecutor, projectID, id string) {
	t.Helper()
	ctx := t.Context()
	membershipRemoved := domain.MembershipStatusRemoved.String()
	userDeactivated := domain.UserStatusDeactivated.String()
	teamDeactivated := domain.TeamStatusDeactivated.String()

	if isSpannerDB {
		_, err := tx.Exec(ctx,
			`UPDATE teams SET status = $1, updated_at = CURRENT_TIMESTAMP() WHERE project_id = $2 AND id = $3`,
			teamDeactivated, projectID, id)
		require.NoError(t, err)
		_, err = tx.Exec(ctx,
			`UPDATE team_memberships SET status = $1, updated_at = CURRENT_TIMESTAMP() WHERE project_id = $2 AND team_id = $3 AND status <> $1`,
			membershipRemoved, projectID, id)
		require.NoError(t, err)
		_, err = tx.Exec(ctx,
			`UPDATE users SET status = $1, updated_at = CURRENT_TIMESTAMP() WHERE project_id = $2 AND lifecycle_owner_team_id = $3 AND status <> $1`,
			userDeactivated, projectID, id)
		require.NoError(t, err)
		_, err = tx.Exec(ctx,
			`UPDATE team_memberships SET status = $1, updated_at = CURRENT_TIMESTAMP() WHERE project_id = $2 AND status <> $1 AND user_id IN (SELECT id FROM users WHERE project_id = $3 AND lifecycle_owner_team_id = $4)`,
			membershipRemoved, projectID, projectID, id)
		require.NoError(t, err)
		return
	}

	_, err := tx.Exec(ctx,
		`UPDATE zitadel_nextgen.teams SET status = $1, updated_at = now() WHERE project_id = $2 AND id = $3`,
		teamDeactivated, projectID, id)
	require.NoError(t, err)
	_, err = tx.Exec(ctx,
		`UPDATE zitadel_nextgen.team_memberships SET status = $1, updated_at = now() WHERE project_id = $2 AND team_id = $3 AND status <> $1`,
		membershipRemoved, projectID, id)
	require.NoError(t, err)
	_, err = tx.Exec(ctx,
		`UPDATE zitadel_nextgen.users SET status = $1, updated_at = now() WHERE project_id = $2 AND lifecycle_owner_team_id = $3 AND status <> $1`,
		userDeactivated, projectID, id)
	require.NoError(t, err)
	_, err = tx.Exec(ctx,
		`UPDATE zitadel_nextgen.team_memberships SET status = $1, updated_at = now() WHERE project_id = $2 AND status <> $1 AND user_id IN (SELECT id FROM zitadel_nextgen.users WHERE project_id = $3 AND lifecycle_owner_team_id = $4)`,
		membershipRemoved, projectID, projectID, id)
	require.NoError(t, err)
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
		ProjectID:               projectID,
		SchemaURL:               schemaURL,
		ID:                      userID,
		LifecycleOwnerTeamID:    lifecycleOwner,
		InitialMembershipTeamID: participation,
		Attributes:              []*domain.CreateAttribute{attr},
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

	userRepo := setupLifecycleFixture(t, tx, pid)
	ensureTeam(t, tx, pid, teamID)

	participation := teamID
	createLifecycleUser(t, tx, userRepo, pid, schemaURL, userID, nil, &participation)

	deactivateTeam(t, tx, pid, teamID)

	got, err := userRepo.Get(ctx, tx, database.WithCondition(userRepo.PrimaryKeyCondition(pid, userID)))
	require.NoError(t, err)
	require.True(t, got.IsSelfOwned())
	require.Equal(t, domain.UserStatusActive, got.Status)

	team := getTeam(t, tx, pid, teamID)
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

	userRepo := setupLifecycleFixture(t, tx, pid)
	ensureTeam(t, tx, pid, teamID)

	owner := teamID
	participation := teamID
	createLifecycleUser(t, tx, userRepo, pid, schemaURL, userID, &owner, &participation)

	deactivateTeam(t, tx, pid, teamID)

	got, err := userRepo.Get(ctx, tx, database.WithCondition(userRepo.PrimaryKeyCondition(pid, userID)))
	require.NoError(t, err)
	require.True(t, got.IsTeamOwned())
	require.Equal(t, domain.UserStatusDeactivated, got.Status)
}

// Team-owned users deactivated via team deactivate lose memberships on all teams
// (same roster policy as UserRepository.Deactivate / ADR 024).
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

	userRepo := setupLifecycleFixture(t, tx, pid)
	ensureTeam(t, tx, pid, ownerTeamID)
	ensureTeam(t, tx, pid, otherTeamID)

	owner := ownerTeamID
	participation := ownerTeamID
	createLifecycleUser(t, tx, userRepo, pid, schemaURL, userID, &owner, &participation)

	membershipRepo := repository.NewTeamMembershipRepository(tx)
	require.NoError(t, membershipRepo.Create(ctx, tx, &domain.TeamMembership{
		ProjectID: pid,
		TeamID:    otherTeamID,
		UserID:    userID,
		Status:    domain.MembershipStatusActive,
	}))

	deactivateTeam(t, tx, pid, ownerTeamID)

	got, err := userRepo.Get(ctx, tx, database.WithCondition(userRepo.PrimaryKeyCondition(pid, userID)))
	require.NoError(t, err)
	require.Equal(t, domain.UserStatusDeactivated, got.Status)

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

	userRepo := setupLifecycleFixture(t, tx, pid)
	ensureTeam(t, tx, pid, teamID)

	participation := teamID
	createLifecycleUser(t, tx, userRepo, pid, schemaURL, userID, nil, &participation)

	require.NoError(t, userRepo.Delete(ctx, tx, userRepo.PrimaryKeyCondition(pid, userID)))

	team := getTeam(t, tx, pid, teamID)
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

// Create with a stale membership team must not leave a partial user row.
func TestUserRepository_Create_RollsBackWhenMembershipInsertFails(t *testing.T) {
	skipIfSpanner(t)
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	const (
		pid       = "proj-lifecycle-create-atomic"
		teamID    = "team-lifecycle-missing"
		userID    = "usr-lifecycle-create-atomic"
		schemaURL = "https://schemas.test/lifecycle-create-atomic/v1.json"
	)

	userRepo := repository.NewUserRepository()
	ensureProject(t, tx, pid)
	ensureJSONSchemaRow(t, tx, pid, schemaURL, []byte("{}"))

	attr, err := domain.NewCreateAttribute("nickname", userID, domain.AttributeUniquenessUnspecified)
	require.NoError(t, err)
	missingTeam := teamID
	err = userRepo.Create(ctx, tx, &domain.CreateUser{
		ProjectID:               pid,
		SchemaURL:               schemaURL,
		ID:                      userID,
		InitialMembershipTeamID: &missingTeam,
		Attributes:              []*domain.CreateAttribute{attr},
	})
	require.Error(t, err)

	_, getErr := userRepo.Get(ctx, tx, database.WithCondition(userRepo.PrimaryKeyCondition(pid, userID)))
	require.Error(t, getErr)
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

	userRepo := setupLifecycleFixture(t, tx, pid)
	ensureTeam(t, tx, pid, teamID)

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

	team := getTeam(t, tx, pid, teamID)
	require.Equal(t, teamID, team.ID, fmt.Sprintf("team %s should still exist after user deactivation", teamID))
}
