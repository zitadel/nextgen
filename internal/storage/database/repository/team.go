package repository

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
)

const pgTableTeams = "zitadel_nextgen.teams"
const spannerTableTeams = "teams"

type teamRow struct {
	ProjectID string    `db:"project_id"`
	ID        string    `db:"id"`
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
	meta teamMeta
	now  database.Instruction
}

var _ domain.TeamRepository = (*TeamRepository)(nil)

// NewTeamRepository returns a dialect-specific [TeamRepository].
func NewTeamRepository(client database.QueryExecutor) *TeamRepository {
	switch client.(type) {
	case spanner.SpannerPooler:
		return &TeamRepository{
			meta: teamMeta{tableName: spannerTableTeams},
			now:  database.CurrentTimestampInstruction,
		}
	case postgres.PostgresPooler:
		return &TeamRepository{
			meta: teamMeta{tableName: pgTableTeams},
			now:  database.NowInstruction,
		}
	}
	panic("NewTeamRepository: unsupported client type")
}

func (r *TeamRepository) Create(ctx context.Context, client database.QueryExecutor, team *domain.Team) error {
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
	b := database.NewStatementBuilder("SELECT project_id, id, created_at, updated_at FROM ")
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
		CreatedAt: row.CreatedAt,
		UpdatedAt: row.UpdatedAt,
	}, nil
}
