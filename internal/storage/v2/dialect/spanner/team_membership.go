package spanner

import (
	"context"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/v2/teammembership"
	"github.com/zitadel/nextgen/internal/storage/v2/userteam"
)

const (
	teamMembershipsTable           = "team_memberships"
	createTeamMembershipStmt       = `INSERT INTO team_memberships (project_id, team_id, user_id, status) VALUES (@p1, @p2, @p3, @p4) THEN RETURN created_at, updated_at`
	updateTeamMembershipStatusStmt = `UPDATE team_memberships SET status = @p1, updated_at = CURRENT_TIMESTAMP() WHERE project_id = @p2 AND team_id = @p3 AND user_id = @p4`
	teamMembershipQuery            = `SELECT project_id, team_id, user_id, status, created_at, updated_at FROM team_memberships`

	// userTeamQuery is the roster read: memberships joined to the team they
	// point at, so one page carries each team's name. The aliases `m` and `t`
	// are the ones userteam.Schema qualifies its column names with.
	userTeamQuery = `SELECT m.project_id, m.user_id, m.team_id, t.name, m.status, m.created_at, m.updated_at
FROM team_memberships m
JOIN teams t ON t.project_id = m.project_id AND t.id = m.team_id`
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
	return withTransaction(ctx, s.db, func(ctx context.Context, tx queryExecutor) error {
		stmt := buildStatement(createTeamMembershipStmt,
			membership.ProjectID, membership.TeamID, membership.UserID, membership.Status.String(),
		).statement()
		if err := tx.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
			_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
				return struct{}{}, row.Columns(&membership.CreatedAt, &membership.UpdatedAt)
			})
			return err
		}); err != nil {
			return err
		}
		edges := newAuthzMembershipEdgeStatements(tx)
		return service.SyncUserTeamMembershipEdge(ctx, &edges, membership.ProjectID, membership.TeamID, membership.UserID, membership.Status)
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

// ListTeamMemberships implements [service.TeamMembershipStatements].
func (s teamMembershipStatements) ListTeamMemberships(ctx context.Context, filter *database.ListOptions[domain.TeamMembershipField]) (*database.ListResult[*domain.TeamMembership], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, teamMembershipQuery, filter, teammembership.Schema); err != nil {
		return nil, err
	}

	var memberships []*domain.TeamMembership
	err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		memberships, err = collectRows(iter, s.scanTeamMembership)
		return err
	})
	if err != nil {
		return nil, err
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

	var teams []*domain.UserTeam
	err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		teams, err = collectRows(iter, s.scanUserTeam)
		return err
	})
	if err != nil {
		return nil, err
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
	return withTransaction(ctx, s.db, func(ctx context.Context, tx queryExecutor) error {
		stmt := buildStatement(updateTeamMembershipStatusStmt, status.String(), projectID, teamID, userID).statement()
		n, err := tx.Update(ctx, stmt)
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

func (s teamMembershipStatements) scanUserTeam(row *spanner.Row) (*domain.UserTeam, error) {
	team := new(domain.UserTeam)
	var status string
	if err := row.Columns(
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
