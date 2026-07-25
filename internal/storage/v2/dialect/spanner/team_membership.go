package spanner

import (
	"context"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	teamMembershipsTable           = "team_memberships"
	createTeamMembershipStmt       = `INSERT INTO team_memberships (project_id, team_id, user_id, status) VALUES (@p1, @p2, @p3, @p4) THEN RETURN created_at, updated_at`
	listTeamMembershipsByUserStmt  = `SELECT project_id, team_id, user_id, status, created_at, updated_at FROM team_memberships WHERE project_id = @p1 AND user_id = @p2`
	listTeamMembershipsByTeamStmt  = `SELECT project_id, team_id, user_id, status, created_at, updated_at FROM team_memberships WHERE project_id = @p1 AND team_id = @p2`
	updateTeamMembershipStatusStmt = `UPDATE team_memberships SET status = @p1, updated_at = CURRENT_TIMESTAMP() WHERE project_id = @p2 AND team_id = @p3 AND user_id = @p4`
)

var teamMembershipColumns = []string{
	"project_id", "team_id", "user_id", "status", "created_at", "updated_at",
}

type teamMembershipStatements struct{ statement }

func newTeamMembershipStatements(db queryExecutor) teamMembershipStatements {
	return teamMembershipStatements{
		statement: statement{
			db: db,
		},
	}
}

// CreateTeamMembership implements [service.TeamMembershipStatements].
func (s teamMembershipStatements) CreateTeamMembership(ctx context.Context, membership *domain.TeamMembership) error {
	stmt := buildStatement(createTeamMembershipStmt,
		membership.ProjectID, membership.TeamID, membership.UserID, membership.Status.String(),
	).statement()
	return s.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&membership.CreatedAt, &membership.UpdatedAt)
		})
		return err
	})
}

// GetTeamMembership implements [service.TeamMembershipStatements].
func (s teamMembershipStatements) GetTeamMembership(ctx context.Context, projectID, teamID, userID string) (*domain.TeamMembership, error) {
	row, err := s.db.ReadRow(ctx, teamMembershipsTable, spanner.Key{projectID, teamID, userID}, teamMembershipColumns)
	if err != nil {
		return nil, err
	}
	return s.scanTeamMembership(row)
}

// ListTeamMembershipsByUser implements [service.TeamMembershipStatements].
func (s teamMembershipStatements) ListTeamMembershipsByUser(ctx context.Context, projectID, userID string) ([]*domain.TeamMembership, error) {
	return s.queryTeamMemberships(ctx, listTeamMembershipsByUserStmt, projectID, userID)
}

// ListTeamMembershipsByTeam implements [service.TeamMembershipStatements].
func (s teamMembershipStatements) ListTeamMembershipsByTeam(ctx context.Context, projectID, teamID string) ([]*domain.TeamMembership, error) {
	return s.queryTeamMemberships(ctx, listTeamMembershipsByTeamStmt, projectID, teamID)
}

func (s teamMembershipStatements) queryTeamMemberships(ctx context.Context, sql string, args ...any) ([]*domain.TeamMembership, error) {
	var memberships []*domain.TeamMembership
	err := s.db.Query(ctx, buildStatement(sql, args...).statement(), func(iter *spanner.RowIterator) error {
		var err error
		memberships, err = collectRows(iter, s.scanTeamMembership)
		return err
	})
	if err != nil {
		return nil, err
	}
	return memberships, nil
}

// UpdateTeamMembershipStatus implements [service.TeamMembershipStatements].
func (s teamMembershipStatements) UpdateTeamMembershipStatus(ctx context.Context, projectID, teamID, userID string, status domain.MembershipStatus) error {
	stmt := buildStatement(updateTeamMembershipStatusStmt, status.String(), projectID, teamID, userID).statement()
	n, err := s.db.Update(ctx, stmt)
	if err != nil {
		return err
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

func (s teamMembershipStatements) scanTeamMembership(row *spanner.Row) (*domain.TeamMembership, error) {
	membership := new(domain.TeamMembership)
	var status string
	if err := row.Columns(
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
