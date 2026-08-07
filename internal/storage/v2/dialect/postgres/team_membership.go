package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/v2/teammembership"
	"github.com/zitadel/nextgen/internal/storage/v2/userteam"
)

const (
	createTeamMembershipStmt       = `INSERT INTO zitadel_nextgen.team_memberships (project_id, team_id, user_id, status) VALUES ($1, $2, $3, $4) RETURNING created_at, updated_at`
	getTeamMembershipStmt          = `SELECT project_id, team_id, user_id, status, created_at, updated_at FROM zitadel_nextgen.team_memberships WHERE project_id = $1 AND team_id = $2 AND user_id = $3`
	updateTeamMembershipStatusStmt = `UPDATE zitadel_nextgen.team_memberships SET status = $1, updated_at = NOW() WHERE project_id = $2 AND team_id = $3 AND user_id = $4`
	teamMembershipQuery            = `SELECT project_id, team_id, user_id, status, created_at, updated_at FROM zitadel_nextgen.team_memberships`

	// userTeamQuery is the roster read: memberships joined to the team they
	// point at, so one page carries each team's name. The aliases `m` and `t`
	// are the ones userteam.Schema qualifies its column names with.
	userTeamQuery = `SELECT m.project_id, m.user_id, m.team_id, t.name, m.status, m.created_at, m.updated_at
FROM zitadel_nextgen.team_memberships m
JOIN zitadel_nextgen.teams t
  ON t.project_id = m.project_id AND t.id = m.team_id`
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

// ListTeamMemberships implements [service.TeamMembershipStatements].
func (s teamMembershipStatements) ListTeamMemberships(ctx context.Context, filter *database.ListOptions[domain.TeamMembershipField]) (*database.ListResult[*domain.TeamMembership], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, teamMembershipQuery, filter, teammembership.Schema); err != nil {
		return nil, err
	}

	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}

	memberships, err := pgx.CollectRows(rows, s.scanTeamMembership)
	if err != nil {
		return nil, wrapError(err)
	}

	var nextCursor []byte
	if filter.Pagination.Limit > 0 && len(memberships) == int(filter.Pagination.Limit) {
		cursor := &pagination.Cursor[domain.TeamMembershipField]{
			Columns: filter.Pagination.OrderBy.Columns,
			Values:  teammembership.Schema.ValuesFrom(memberships[len(memberships)-1], filter.Pagination.OrderBy.Columns),
		}
		nextCursor = cursor.Marshal()
	}

	return &database.ListResult[*domain.TeamMembership]{
		Items:      memberships,
		NextCursor: nextCursor,
	}, nil
}

// ListUserTeams implements [service.TeamMembershipStatements].
func (s teamMembershipStatements) ListUserTeams(ctx context.Context, filter *database.ListOptions[domain.UserTeamField]) (*database.ListResult[*domain.UserTeam], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, userTeamQuery, filter, userteam.Schema); err != nil {
		return nil, err
	}

	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}

	teams, err := pgx.CollectRows(rows, s.scanUserTeam)
	if err != nil {
		return nil, wrapError(err)
	}

	var nextCursor []byte
	if filter.Pagination.Limit > 0 && len(teams) == int(filter.Pagination.Limit) {
		cursor := &pagination.Cursor[domain.UserTeamField]{
			Columns: filter.Pagination.OrderBy.Columns,
			Values:  userteam.Schema.ValuesFrom(teams[len(teams)-1], filter.Pagination.OrderBy.Columns),
		}
		nextCursor = cursor.Marshal()
	}

	return &database.ListResult[*domain.UserTeam]{
		Items:      teams,
		NextCursor: nextCursor,
	}, nil
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

func (s teamMembershipStatements) scanUserTeam(row pgx.CollectableRow) (*domain.UserTeam, error) {
	team := new(domain.UserTeam)
	var status string
	if err := row.Scan(
		&team.ProjectID,
		&team.UserID,
		&team.TeamID,
		&team.TeamName,
		&status,
		&team.CreatedAt,
		&team.UpdatedAt,
	); err != nil {
		return nil, err
	}
	team.Status = domain.MembershipStatus(status)
	return team, nil
}

var _ service.TeamMembershipStatements = (*teamMembershipStatements)(nil)
