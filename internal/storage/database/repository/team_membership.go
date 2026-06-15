package repository

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const teamMembershipTable = "zitadel_nextgen.team_memberships"

var (
	colMembershipProjectID = database.NewColumn(teamMembershipTable, "project_id")
	colMembershipTeamID    = database.NewColumn(teamMembershipTable, "team_id")
	colMembershipUserID    = database.NewColumn(teamMembershipTable, "user_id")
	colMembershipStatus    = database.NewColumn(teamMembershipTable, "status")
	colMembershipCreatedAt = database.NewColumn(teamMembershipTable, "created_at")
	colMembershipUpdatedAt = database.NewColumn(teamMembershipTable, "updated_at")
)

type teamMembershipRow struct {
	ProjectID string    `db:"project_id"`
	TeamID    string    `db:"team_id"`
	UserID    string    `db:"user_id"`
	Status    string    `db:"status"`
	CreatedAt time.Time `db:"created_at"`
	UpdatedAt time.Time `db:"updated_at"`
}

func (r teamMembershipRow) toDomain() *domain.TeamMembership {
	return &domain.TeamMembership{
		ProjectID: r.ProjectID,
		TeamID:    r.TeamID,
		UserID:    r.UserID,
		Status:    domain.MembershipStatus(r.Status),
		CreatedAt: r.CreatedAt,
		UpdatedAt: r.UpdatedAt,
	}
}

type TeamMembershipRepository struct {
	now database.Instruction
}

func NewTeamMembershipRepository() *TeamMembershipRepository {
	return &TeamMembershipRepository{now: database.NowInstruction}
}

func (r *TeamMembershipRepository) qualifiedTableName() string { return teamMembershipTable }

func (r *TeamMembershipRepository) PrimaryKeyColumns() []database.Column {
	return []database.Column{colMembershipProjectID, colMembershipTeamID, colMembershipUserID}
}

func (r *TeamMembershipRepository) UpdatedAtColumn() database.Column { return colMembershipUpdatedAt }

func (r *TeamMembershipRepository) Create(ctx context.Context, client database.QueryExecutor, m *domain.TeamMembership) error {
	status := m.Status
	if status == "" {
		status = domain.MembershipStatusActive
	}
	b := database.NewStatementBuilder("INSERT INTO ")
	b.WriteString(r.qualifiedTableName())
	b.WriteString(" (project_id, team_id, user_id, status, created_at, updated_at) VALUES (")
	b.WriteArgs(m.ProjectID, m.TeamID, m.UserID, status.String(), r.now, r.now)
	b.WriteString(")")
	_, err := client.Exec(ctx, b.String(), b.Args()...)
	return err
}

func (r *TeamMembershipRepository) Get(ctx context.Context, client database.QueryExecutor, projectID, teamID, userID string) (*domain.TeamMembership, error) {
	b := database.NewStatementBuilder("SELECT project_id, team_id, user_id, status, created_at, updated_at FROM ")
	b.WriteString(r.qualifiedTableName())
	b.WriteString(" WHERE project_id = ")
	b.WriteArg(projectID)
	b.WriteString(" AND team_id = ")
	b.WriteArg(teamID)
	b.WriteString(" AND user_id = ")
	b.WriteArg(userID)
	row, err := getOne[teamMembershipRow](ctx, client, b)
	if err != nil {
		return nil, err
	}
	return row.toDomain(), nil
}

func (r *TeamMembershipRepository) ListByUser(ctx context.Context, client database.QueryExecutor, projectID, userID string) ([]*domain.TeamMembership, error) {
	b := database.NewStatementBuilder("SELECT project_id, team_id, user_id, status, created_at, updated_at FROM ")
	b.WriteString(r.qualifiedTableName())
	b.WriteString(" WHERE project_id = ")
	b.WriteArg(projectID)
	b.WriteString(" AND user_id = ")
	b.WriteArg(userID)
	rows, err := getMany[teamMembershipRow](ctx, client, b)
	if err != nil {
		return nil, err
	}
	out := make([]*domain.TeamMembership, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.toDomain())
	}
	return out, nil
}

func (r *TeamMembershipRepository) ListByTeam(ctx context.Context, client database.QueryExecutor, projectID, teamID string) ([]*domain.TeamMembership, error) {
	b := database.NewStatementBuilder("SELECT project_id, team_id, user_id, status, created_at, updated_at FROM ")
	b.WriteString(r.qualifiedTableName())
	b.WriteString(" WHERE project_id = ")
	b.WriteArg(projectID)
	b.WriteString(" AND team_id = ")
	b.WriteArg(teamID)
	rows, err := getMany[teamMembershipRow](ctx, client, b)
	if err != nil {
		return nil, err
	}
	out := make([]*domain.TeamMembership, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.toDomain())
	}
	return out, nil
}

func (r *TeamMembershipRepository) UpdateStatus(ctx context.Context, client database.QueryExecutor, projectID, teamID, userID string, status domain.MembershipStatus) error {
	cond := database.And(
		database.NewTextCondition(colMembershipProjectID, database.TextOperationEqual, projectID),
		database.NewTextCondition(colMembershipTeamID, database.TextOperationEqual, teamID),
		database.NewTextCondition(colMembershipUserID, database.TextOperationEqual, userID),
	)
	_, err := updateOne(ctx, client, r, cond,
		database.NewChange(colMembershipStatus, status.String()),
		database.NewChange(colMembershipUpdatedAt, r.now),
	)
	return err
}

var _ domain.TeamMembershipRepository = (*TeamMembershipRepository)(nil)
