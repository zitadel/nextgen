package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	createTeamMembershipStmt       = `INSERT INTO zitadel_nextgen.team_memberships (project_id, team_id, user_id, status) VALUES ($1, $2, $3, $4) RETURNING created_at, updated_at`
	getTeamMembershipStmt          = `SELECT project_id, team_id, user_id, status, created_at, updated_at FROM zitadel_nextgen.team_memberships WHERE project_id = $1 AND team_id = $2 AND user_id = $3`
	listTeamMembershipsByUserStmt  = `SELECT project_id, team_id, user_id, status, created_at, updated_at FROM zitadel_nextgen.team_memberships WHERE project_id = $1 AND user_id = $2`
	listTeamMembershipsByTeamStmt  = `SELECT project_id, team_id, user_id, status, created_at, updated_at FROM zitadel_nextgen.team_memberships WHERE project_id = $1 AND team_id = $2`
	updateTeamMembershipStatusStmt = `UPDATE zitadel_nextgen.team_memberships SET status = $1, updated_at = NOW() WHERE project_id = $2 AND team_id = $3 AND user_id = $4`
)

type teamMembershipStatements struct{ statement }

func newTeamMembershipStatements(client queryExecutor) teamMembershipStatements {
	return teamMembershipStatements{
		statement: statement{
			client: client,
		},
	}
}

// CreateTeamMembership implements [service.TeamMembershipStatements].
func (s teamMembershipStatements) CreateTeamMembership(ctx context.Context, membership *domain.TeamMembership) error {
	err := s.client.QueryRow(ctx, createTeamMembershipStmt,
		membership.ProjectID, membership.TeamID, membership.UserID, membership.Status.String(),
	).Scan(&membership.CreatedAt, &membership.UpdatedAt)
	if err != nil {
		return wrapError(err)
	}
	return nil
}

// GetTeamMembership implements [service.TeamMembershipStatements].
func (s teamMembershipStatements) GetTeamMembership(ctx context.Context, projectID, teamID, userID string) (*domain.TeamMembership, error) {
	rows, err := s.client.Query(ctx, getTeamMembershipStmt, projectID, teamID, userID)
	if err != nil {
		return nil, wrapError(err)
	}
	membership, err := pgx.CollectExactlyOneRow(rows, s.scanTeamMembership)
	if err != nil {
		return nil, wrapError(err)
	}
	return membership, nil
}

// ListTeamMembershipsByUser implements [service.TeamMembershipStatements].
func (s teamMembershipStatements) ListTeamMembershipsByUser(ctx context.Context, projectID, userID string) ([]*domain.TeamMembership, error) {
	rows, err := s.client.Query(ctx, listTeamMembershipsByUserStmt, projectID, userID)
	if err != nil {
		return nil, wrapError(err)
	}
	memberships, err := pgx.CollectRows(rows, s.scanTeamMembership)
	if err != nil {
		return nil, wrapError(err)
	}
	return memberships, nil
}

// ListTeamMembershipsByTeam implements [service.TeamMembershipStatements].
func (s teamMembershipStatements) ListTeamMembershipsByTeam(ctx context.Context, projectID, teamID string) ([]*domain.TeamMembership, error) {
	rows, err := s.client.Query(ctx, listTeamMembershipsByTeamStmt, projectID, teamID)
	if err != nil {
		return nil, wrapError(err)
	}
	memberships, err := pgx.CollectRows(rows, s.scanTeamMembership)
	if err != nil {
		return nil, wrapError(err)
	}
	return memberships, nil
}

// UpdateTeamMembershipStatus implements [service.TeamMembershipStatements].
func (s teamMembershipStatements) UpdateTeamMembershipStatus(ctx context.Context, projectID, teamID, userID string, status domain.MembershipStatus) error {
	tag, err := s.client.Exec(ctx, updateTeamMembershipStatusStmt, status.String(), projectID, teamID, userID)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

func (s teamMembershipStatements) scanTeamMembership(row pgx.CollectableRow) (*domain.TeamMembership, error) {
	membership := new(domain.TeamMembership)
	var status string
	if err := row.Scan(
		&membership.ProjectID,
		&membership.TeamID,
		&membership.UserID,
		&status,
		&membership.CreatedAt,
		&membership.UpdatedAt,
	); err != nil {
		return nil, err
	}
	membership.Status = domain.MembershipStatus(status)
	return membership, nil
}

var _ service.TeamMembershipStatements = (*teamMembershipStatements)(nil)
