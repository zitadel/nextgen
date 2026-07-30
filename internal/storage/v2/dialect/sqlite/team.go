package sqlite

import (
	"context"
	"database/sql"
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const (
	createTeamStmt = `INSERT INTO teams (project_id, id, name, created_at, updated_at)
VALUES (?, ?, ?, ?, ?) RETURNING project_id, id, name, status, created_at, updated_at`

	deactivateTeamStmt = `UPDATE teams SET status = ?, updated_at = ? WHERE project_id = ? AND id = ?`

	deactivateTeamMembershipsStmt = `UPDATE team_memberships SET status = ?, updated_at = ?
WHERE project_id = ? AND team_id = ? AND status <> ?`

	deactivateTeamOwnedUsersStmt = `UPDATE users SET status = ?, updated_at = ?
WHERE project_id = ? AND lifecycle_owner_team_id = ? AND status <> ?`

	deactivateOwnedUsersMembershipsStmt = `UPDATE team_memberships SET status = ?, updated_at = ?
WHERE project_id = ? AND status <> ?
  AND user_id IN (SELECT id FROM users WHERE project_id = ? AND lifecycle_owner_team_id = ?)`

	getTeamQuery = `SELECT project_id, id, name, status, created_at, updated_at FROM teams`
)

type teamStatements struct{ statement }

func newTeamStatements(client queryExecutor) teamStatements {
	return teamStatements{statement: statement{client: client}}
}

// CreateTeam implements [service.TeamStatements].
func (ts teamStatements) CreateTeam(ctx context.Context, team *domain.Team) error {
	if team.ID == "" {
		return errors.New("team ID must not be empty")
	}
	now := nowUnixNano()
	row := ts.client.QueryRow(ctx, createTeamStmt, team.ProjectID, team.ID, team.Name, now, now)
	return wrapError(scanTeamRow(row, team))
}

// GetTeamByID implements [service.TeamStatements].
func (ts teamStatements) GetTeamByID(ctx context.Context, projectID, id string) (*domain.Team, error) {
	rows, err := ts.client.Query(ctx, getTeamQuery+` WHERE project_id = ? AND id = ?`, projectID, id)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	team, err := collectExactlyOneRow(rows, scanTeam)
	if err != nil {
		return nil, wrapError(err)
	}
	return team, nil
}

// DeactivateTeam implements [service.TeamStatements].
func (ts teamStatements) DeactivateTeam(ctx context.Context, projectID, id string) error {
	membershipRemoved := domain.MembershipStatusRemoved.String()
	userDeactivated := domain.UserStatusDeactivated.String()
	teamDeactivated := domain.TeamStatusDeactivated.String()
	now := nowUnixNano()

	return withTransaction(ctx, ts.client, func(ctx context.Context, tx queryExecutor) error {
		for _, step := range []struct {
			sql  string
			args []any
		}{
			{deactivateTeamStmt, []any{teamDeactivated, now, projectID, id}},
			{deactivateTeamMembershipsStmt, []any{membershipRemoved, now, projectID, id, membershipRemoved}},
			{deactivateTeamOwnedUsersStmt, []any{userDeactivated, now, projectID, id, userDeactivated}},
			{deactivateOwnedUsersMembershipsStmt, []any{membershipRemoved, now, projectID, membershipRemoved, projectID, id}},
		} {
			if _, err := tx.Exec(ctx, step.sql, step.args...); err != nil {
				return wrapError(err)
			}
		}
		return nil
	})
}

func scanTeamRow(row *sql.Row, team *domain.Team) error {
	var (
		statusStr            string
		createdNano, updNano int64
	)
	if err := row.Scan(&team.ProjectID, &team.ID, &team.Name, &statusStr, &createdNano, &updNano); err != nil {
		return err
	}
	team.Status = domain.TeamStatus(statusStr)
	team.CreatedAt = timeFromUnixNano(createdNano)
	team.UpdatedAt = timeFromUnixNano(updNano)
	return nil
}

func scanTeam(rows *sql.Rows) (*domain.Team, error) {
	team := new(domain.Team)
	var (
		statusStr            string
		createdNano, updNano int64
	)
	if err := rows.Scan(&team.ProjectID, &team.ID, &team.Name, &statusStr, &createdNano, &updNano); err != nil {
		return nil, err
	}
	team.Status = domain.TeamStatus(statusStr)
	team.CreatedAt = timeFromUnixNano(createdNano)
	team.UpdatedAt = timeFromUnixNano(updNano)
	return team, nil
}

var _ service.TeamStatements = (*teamStatements)(nil)
