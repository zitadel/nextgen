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

// Acceptance signal: deleting a user does not cascade-delete teams they participate in.
// Team-deactivation cascade coverage lives in v2 dialect tests
// (TestTeamStatements_Deactivate_CascadesMembershipsAndOwnedUsers) so production
// DeactivateTeam SQL is exercised instead of a forked copy.
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

// project deletion purges teams, users, and their
// memberships together (unlike team/user deletion, which must not cascade).
func TestUserTeamLifecycle_ProjectDeleteCascadesThroughMemberships(t *testing.T) {
	skipIfSpanner(t)
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	const (
		pid       = "proj-lifecycle-project-delete"
		teamID    = "team-lifecycle-project-delete"
		userID    = "usr-lifecycle-project-delete"
		schemaURL = "https://schemas.test/lifecycle-project-delete/v1.json"
	)

	userRepo := setupLifecycleFixture(t, tx, pid)
	ensureTeam(t, tx, pid, teamID)

	participation := teamID
	createLifecycleUser(t, tx, userRepo, pid, schemaURL, userID, nil, &participation)

	deleteProject(t, tx, pid)

	_, err := userRepo.Get(ctx, tx, database.WithCondition(userRepo.PrimaryKeyCondition(pid, userID)))
	require.ErrorIs(t, err, new(database.NoRowFoundError))

	var teamCount int
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT count(*) FROM zitadel_nextgen.teams WHERE project_id = $1 AND id = $2`,
		pid, teamID).Scan(&teamCount))
	require.Zero(t, teamCount, "team should be removed by project delete cascade")

	row := tx.QueryRow(ctx,
		fmt.Sprintf(`SELECT status FROM %s WHERE project_id = $1 AND team_id = $2 AND user_id = $3`, dbTable("team_memberships")),
		pid, teamID, userID,
	)
	var status string
	require.Error(t, row.Scan(&status), "membership should be removed with project delete cascade")
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

	require.Equal(t, domain.MembershipStatusRemoved, getTeamMembershipStatus(t, tx, pid, teamID, userID))

	team := getTeam(t, tx, pid, teamID)
	require.Equal(t, teamID, team.ID, fmt.Sprintf("team %s should still exist after user deactivation", teamID))
}
