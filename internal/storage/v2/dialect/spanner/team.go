package spanner

import (
	"context"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const (
	teamsTable     = "teams"
	createTeamStmt = `INSERT INTO teams (project_id, id, name) VALUES (@p1, @p2, @p3) THEN RETURN project_id, id, name, status, created_at, updated_at`

	deactivateTeamStmt = `
UPDATE teams
SET status = @p1, updated_at = CURRENT_TIMESTAMP()
WHERE project_id = @p2 AND id = @p3`

	deactivateTeamMembershipsStmt = `
UPDATE team_memberships
SET status = @p1, updated_at = CURRENT_TIMESTAMP()
WHERE project_id = @p2 AND team_id = @p3 AND status <> @p1`

	deactivateTeamOwnedUsersStmt = `
UPDATE users
SET status = @p1, updated_at = CURRENT_TIMESTAMP()
WHERE project_id = @p2 AND lifecycle_owner_team_id = @p3 AND status <> @p1`

	deactivateOwnedUsersMembershipsStmt = `
UPDATE team_memberships
SET status = @p1, updated_at = CURRENT_TIMESTAMP()
WHERE project_id = @p2 AND status <> @p1
  AND user_id IN (
    SELECT id FROM users
    WHERE project_id = @p3 AND lifecycle_owner_team_id = @p4
  )`
)

var teamColumns = []string{
	"project_id", "id", "name", "status", "created_at", "updated_at",
}

type teamStatements struct{ statement }

func newTeamStatements(db queryExecutor) teamStatements {
	return teamStatements{
		statement: statement{
			db: db,
		},
	}
}

// CreateTeam implements [service.TeamStatements].
func (ts teamStatements) CreateTeam(ctx context.Context, team *domain.Team) error {
	if err := ensureManagedID(&team.ID, domain.PrefixTeam); err != nil {
		return err
	}
	stmt := buildStatement(createTeamStmt, team.ProjectID, team.ID, team.Name).statement()
	return ts.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			var status string
			if err := row.Columns(&team.ProjectID, &team.ID, &team.Name, &status, &team.CreatedAt, &team.UpdatedAt); err != nil {
				return struct{}{}, err
			}
			team.Status = domain.TeamStatus(status)
			return struct{}{}, nil
		})
		return err
	})
}

// GetTeamByID implements [service.TeamStatements].
func (ts teamStatements) GetTeamByID(ctx context.Context, projectID, id string) (*domain.Team, error) {
	row, err := ts.db.ReadRow(ctx, teamsTable, spanner.Key{projectID, id}, teamColumns)
	if err != nil {
		return nil, err
	}
	return ts.scanTeam(row)
}

// DeactivateTeam implements [service.TeamStatements].
func (ts teamStatements) DeactivateTeam(ctx context.Context, projectID, id string) error {
	membershipRemoved := domain.MembershipStatusRemoved.String()
	userDeactivated := domain.UserStatusDeactivated.String()
	teamDeactivated := domain.TeamStatusDeactivated.String()

	return withTransaction(ctx, ts.db, func(ctx context.Context, tx queryExecutor) error {
		for _, step := range []struct {
			sql  string
			args []any
		}{
			{deactivateTeamStmt, []any{teamDeactivated, projectID, id}},
			{deactivateTeamMembershipsStmt, []any{membershipRemoved, projectID, id}},
			{deactivateTeamOwnedUsersStmt, []any{userDeactivated, projectID, id}},
			{deactivateOwnedUsersMembershipsStmt, []any{membershipRemoved, projectID, projectID, id}},
		} {
			if _, err := tx.Update(ctx, buildStatement(step.sql, step.args...).statement()); err != nil {
				return err
			}
		}
		return nil
	})
}

func (ts teamStatements) scanTeam(row *spanner.Row) (*domain.Team, error) {
	team := new(domain.Team)
	var status string
	if err := row.Columns(&team.ProjectID, &team.ID, &team.Name, &status, &team.CreatedAt, &team.UpdatedAt); err != nil {
		return nil, err
	}
	team.Status = domain.TeamStatus(status)
	return team, nil
}

var _ service.TeamStatements = (*teamStatements)(nil)
