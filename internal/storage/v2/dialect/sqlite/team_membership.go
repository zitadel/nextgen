package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/v2/teammembership"
)

const (
	createTeamMembershipStmt = `INSERT INTO team_memberships (project_id, team_id, user_id, status, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?) RETURNING created_at, updated_at`

	updateTeamMembershipStatusStmt = `UPDATE team_memberships SET status = ?, updated_at = ?
WHERE project_id = ? AND team_id = ? AND user_id = ?`

	teamMembershipQuery = `SELECT project_id, team_id, user_id, status, created_at, updated_at FROM team_memberships`
)

type teamMembershipStatements struct{ statement }

func newTeamMembershipStatements(client queryExecutor) teamMembershipStatements {
	return teamMembershipStatements{statement: statement{client: client}}
}

// CreateTeamMembership implements [service.TeamMembershipStatements].
func (s teamMembershipStatements) CreateTeamMembership(ctx context.Context, membership *domain.TeamMembership) error {
	now := nowUnixNano()
	return withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		var createdNano, updNano int64
		err := tx.QueryRow(ctx, createTeamMembershipStmt,
			membership.ProjectID, membership.TeamID, membership.UserID, membership.Status.String(), now, now,
		).Scan(&createdNano, &updNano)
		if err != nil {
			return wrapError(err)
		}
		membership.CreatedAt = timeFromUnixNano(createdNano)
		membership.UpdatedAt = timeFromUnixNano(updNano)
		edges := newAuthzMembershipEdgeStatements(tx)
		return service.SyncUserTeamMembershipEdge(ctx, &edges, membership.ProjectID, membership.TeamID, membership.UserID, membership.Status)
	})
}

// GetTeamMembership implements [service.TeamMembershipStatements].
func (s teamMembershipStatements) GetTeamMembership(ctx context.Context, projectID, teamID, userID string) (*domain.TeamMembership, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, teamMembershipQuery, &database.ListOptions[domain.TeamMembershipField]{
		Filter: database.And(
			database.Equal(database.Col(domain.TeamMembershipFieldProjectID), projectID),
			database.Equal(database.Col(domain.TeamMembershipFieldTeamID), teamID),
			database.Equal(database.Col(domain.TeamMembershipFieldUserID), userID),
		),
	}, teammembership.Schema); err != nil {
		return nil, err
	}
	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	m, err := collectExactlyOneRow(rows, scanTeamMembership)
	if err != nil {
		return nil, wrapError(err)
	}
	return m, nil
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
	defer rows.Close()
	memberships, err := collectRows(rows, scanTeamMembership)
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
	return &database.ListResult[*domain.TeamMembership]{Items: memberships, NextCursor: nextCursor}, nil
}

// UpdateTeamMembershipStatus implements [service.TeamMembershipStatements].
func (s teamMembershipStatements) UpdateTeamMembershipStatus(ctx context.Context, projectID, teamID, userID string, status domain.MembershipStatus) error {
	now := nowUnixNano()
	return withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		n, err := execAffected(ctx, tx, updateTeamMembershipStatusStmt, status.String(), now, projectID, teamID, userID)
		if err != nil {
			return err
		}
		if n == 0 {
			return database.NewNoRowFoundError(nil)
		}
		edges := newAuthzMembershipEdgeStatements(tx)
		return service.SyncUserTeamMembershipEdge(ctx, &edges, projectID, teamID, userID, status)
	})
}

func scanTeamMembership(rows *sql.Rows) (*domain.TeamMembership, error) {
	membership := new(domain.TeamMembership)
	var (
		statusStr            string
		createdNano, updNano int64
	)
	if err := rows.Scan(
		&membership.ProjectID, &membership.TeamID, &membership.UserID,
		&statusStr, &createdNano, &updNano,
	); err != nil {
		return nil, err
	}
	membership.Status = domain.MembershipStatus(statusStr)
	membership.CreatedAt = timeFromUnixNano(createdNano)
	membership.UpdatedAt = timeFromUnixNano(updNano)
	return membership, nil
}

var _ service.TeamMembershipStatements = (*teamMembershipStatements)(nil)
