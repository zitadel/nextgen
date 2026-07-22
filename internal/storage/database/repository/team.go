package repository

import (
	"context"
	"errors"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
)

const (
	pgTableTeams        = "zitadel_nextgen.teams"
	pgTableMemberships  = "zitadel_nextgen.team_memberships"
	pgTableUsers        = "zitadel_nextgen.users"
	spannerTableTeams   = "teams"
	spannerTableMembers = "team_memberships"
	spannerTableUsers   = "users"
)

type teamRow struct {
	ProjectID string    `db:"project_id"`
	ID        string    `db:"id"`
	Status    string    `db:"status"`
	CreatedAt time.Time `db:"created_at"`
	UpdatedAt time.Time `db:"updated_at"`
}

type teamMeta struct{ tableName string }

func (m teamMeta) PrimaryKeyColumns() []database.Column {
	return []database.Column{
		database.NewColumn(m.tableName, "project_id"),
		database.NewColumn(m.tableName, "id"),
	}
}

func (m teamMeta) UpdatedAtColumn() database.Column {
	return database.NewColumn(m.tableName, "updated_at")
}

func (m teamMeta) qualifiedTableName() string { return m.tableName }

var _ updatable = (*teamMeta)(nil)
var _ deletable = (*teamMeta)(nil)

// TeamRepository implements [domain.TeamRepository].
type TeamRepository struct {
	meta             teamMeta
	membershipsTable string
	usersTable       string
	now              database.Instruction
}

var _ domain.TeamRepository = (*TeamRepository)(nil)

// NewTeamRepository returns a dialect-specific [TeamRepository].
func NewTeamRepository(client database.QueryExecutor) *TeamRepository {
	switch client.(type) {
	case spanner.SpannerPooler:
		return &TeamRepository{
			meta:             teamMeta{tableName: spannerTableTeams},
			membershipsTable: spannerTableMembers,
			usersTable:       spannerTableUsers,
			now:              database.CurrentTimestampInstruction,
		}
	case postgres.PostgresPooler:
		return &TeamRepository{
			meta:             teamMeta{tableName: pgTableTeams},
			membershipsTable: pgTableMemberships,
			usersTable:       pgTableUsers,
			now:              database.NowInstruction,
		}
	}
	panic("NewTeamRepository: unsupported client type")
}

func (r *TeamRepository) Create(ctx context.Context, client database.QueryExecutor, team *domain.Team) error {
	if team.ID == "" {
		return errors.New("team ID must not be empty")
	}
	b := database.NewStatementBuilder("INSERT INTO ")
	b.WriteString(r.meta.tableName)
	b.WriteString(" (project_id, id, created_at, updated_at) VALUES (")
	b.WriteArg(team.ProjectID)
	b.WriteString(", ")
	b.WriteArg(team.ID)
	b.WriteString(", ")
	b.WriteArg(r.now)
	b.WriteString(", ")
	b.WriteArg(r.now)
	b.WriteString(")")
	_, err := client.Exec(ctx, b.String(), b.Args()...)
	return err
}

func (r *TeamRepository) Get(ctx context.Context, client database.QueryExecutor, projectID, id string) (*domain.Team, error) {
	b := database.NewStatementBuilder("SELECT project_id, id, status, created_at, updated_at FROM ")
	b.WriteString(r.meta.tableName)
	b.WriteString(" WHERE project_id = ")
	b.WriteArg(projectID)
	b.WriteString(" AND id = ")
	b.WriteArg(id)
	row, err := getOne[teamRow](ctx, client, b)
	if err != nil {
		return nil, err
	}
	return &domain.Team{
		ProjectID: row.ProjectID,
		ID:        row.ID,
		Status:    domain.TeamStatus(row.Status),
		CreatedAt: row.CreatedAt,
		UpdatedAt: row.UpdatedAt,
	}, nil
}

func (r *TeamRepository) Deactivate(ctx context.Context, client database.QueryExecutor, projectID, id string) error {
	return withTransaction(ctx, client, func(ctx context.Context, tx database.QueryExecutor) error {
		t := r.meta.tableName
		cond := database.And(
			database.NewTextCondition(database.NewColumn(t, "project_id"), database.TextOperationEqual, projectID),
			database.NewTextCondition(database.NewColumn(t, "id"), database.TextOperationEqual, id),
		)
		if _, err := updateOne(ctx, tx, r.meta, cond,
			database.NewChange(database.NewColumn(t, "status"), domain.TeamStatusDeactivated.String()),
			database.NewChange(r.meta.UpdatedAtColumn(), r.now),
		); err != nil {
			return err
		}
		membershipRemoved := domain.MembershipStatusRemoved.String()
		userDeactivated := domain.UserStatusDeactivated.String()

		// Remove roster access to this team for all participants (self-owned and team-owned).
		mb := database.NewStatementBuilder("UPDATE ")
		mb.WriteString(r.membershipsTable)
		mb.WriteString(" SET status = ")
		mb.WriteArg(membershipRemoved)
		mb.WriteString(", updated_at = ")
		mb.WriteArg(r.now)
		mb.WriteString(" WHERE project_id = ")
		mb.WriteArg(projectID)
		mb.WriteString(" AND team_id = ")
		mb.WriteArg(id)
		mb.WriteString(" AND status <> ")
		mb.WriteArg(membershipRemoved)
		if _, err := tx.Exec(ctx, mb.String(), mb.Args()...); err != nil {
			return err
		}

		// Deactivate users lifecycle-owned by this team (ADR 024).
		ub := database.NewStatementBuilder("UPDATE ")
		ub.WriteString(r.usersTable)
		ub.WriteString(" SET status = ")
		ub.WriteArg(userDeactivated)
		ub.WriteString(", updated_at = ")
		ub.WriteArg(r.now)
		ub.WriteString(" WHERE project_id = ")
		ub.WriteArg(projectID)
		ub.WriteString(" AND lifecycle_owner_team_id = ")
		ub.WriteArg(id)
		ub.WriteString(" AND status <> ")
		ub.WriteArg(userDeactivated)
		if _, err := tx.Exec(ctx, ub.String(), ub.Args()...); err != nil {
			return err
		}

		// Match UserRepository.Deactivate: deprovisioned users lose all memberships/access,
		// including roster rows on other teams.
		ob := database.NewStatementBuilder("UPDATE ")
		ob.WriteString(r.membershipsTable)
		ob.WriteString(" SET status = ")
		ob.WriteArg(membershipRemoved)
		ob.WriteString(", updated_at = ")
		ob.WriteArg(r.now)
		ob.WriteString(" WHERE project_id = ")
		ob.WriteArg(projectID)
		ob.WriteString(" AND status <> ")
		ob.WriteArg(membershipRemoved)
		ob.WriteString(" AND user_id IN (SELECT id FROM ")
		ob.WriteString(r.usersTable)
		ob.WriteString(" WHERE project_id = ")
		ob.WriteArg(projectID)
		ob.WriteString(" AND lifecycle_owner_team_id = ")
		ob.WriteArg(id)
		ob.WriteString(")")
		_, err := tx.Exec(ctx, ob.String(), ob.Args()...)
		return err
	})
}
