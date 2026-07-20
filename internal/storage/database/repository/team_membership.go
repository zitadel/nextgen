package repository

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
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

type teamMembershipMeta struct{ tableName string }

func (m teamMembershipMeta) PrimaryKeyColumns() []database.Column {
	return []database.Column{
		database.NewColumn(m.tableName, "project_id"),
		database.NewColumn(m.tableName, "team_id"),
		database.NewColumn(m.tableName, "user_id"),
	}
}

func (m teamMembershipMeta) UpdatedAtColumn() database.Column {
	return database.NewColumn(m.tableName, "updated_at")
}

func (m teamMembershipMeta) qualifiedTableName() string { return m.tableName }

func (m teamMembershipMeta) col(name string) database.Column {
	return database.NewColumn(m.tableName, name)
}

var _ updatable = (*teamMembershipMeta)(nil)

// TeamMembershipRepository persists team roster participation.
type TeamMembershipRepository struct {
	meta teamMembershipMeta
	now  database.Instruction
}

// NewTeamMembershipRepository returns a dialect-specific [TeamMembershipRepository].
func NewTeamMembershipRepository(client database.QueryExecutor) *TeamMembershipRepository {
	switch client.(type) {
	case spanner.SpannerPooler:
		return &TeamMembershipRepository{
			meta: teamMembershipMeta{tableName: spannerTableMembers},
			now:  database.CurrentTimestampInstruction,
		}
	case postgres.PostgresPooler:
		return &TeamMembershipRepository{
			meta: teamMembershipMeta{tableName: pgTableMemberships},
			now:  database.NowInstruction,
		}
	}
	panic("NewTeamMembershipRepository: unsupported client type")
}

func (r *TeamMembershipRepository) Create(ctx context.Context, client database.QueryExecutor, m *domain.TeamMembership) error {
	status := m.Status
	if status == "" {
		status = domain.MembershipStatusActive
	}
	b := database.NewStatementBuilder("INSERT INTO ")
	b.WriteString(r.meta.tableName)
	b.WriteString(" (project_id, team_id, user_id, status, created_at, updated_at) VALUES (")
	b.WriteArgs(m.ProjectID, m.TeamID, m.UserID, status.String(), r.now, r.now)
	b.WriteString(")")
	_, err := client.Exec(ctx, b.String(), b.Args()...)
	return err
}

func (r *TeamMembershipRepository) Get(ctx context.Context, client database.QueryExecutor, projectID, teamID, userID string) (*domain.TeamMembership, error) {
	b := database.NewStatementBuilder("SELECT project_id, team_id, user_id, status, created_at, updated_at FROM ")
	b.WriteString(r.meta.tableName)
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
	b.WriteString(r.meta.tableName)
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
	b.WriteString(r.meta.tableName)
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
		database.NewTextCondition(r.meta.col("project_id"), database.TextOperationEqual, projectID),
		database.NewTextCondition(r.meta.col("team_id"), database.TextOperationEqual, teamID),
		database.NewTextCondition(r.meta.col("user_id"), database.TextOperationEqual, userID),
	)
	_, err := updateOne(ctx, client, r.meta, cond,
		database.NewChange(r.meta.col("status"), status.String()),
		database.NewChange(r.meta.UpdatedAtColumn(), r.now),
	)
	return err
}

var _ domain.TeamMembershipRepository = (*TeamMembershipRepository)(nil)
