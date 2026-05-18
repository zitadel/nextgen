package repository

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
)

const pgTableProjects = "zitadel_nextgen.projects"
const spannerTableProjects = "projects"

type projectRow struct {
	ID        string    `db:"id"`
	CreatedAt time.Time `db:"created_at"`
	UpdatedAt time.Time `db:"updated_at"`
}

type projectMeta struct{ tableName string }

func (m projectMeta) PrimaryKeyColumns() []database.Column {
	return []database.Column{database.NewColumn(m.tableName, "id")}
}

func (m projectMeta) UpdatedAtColumn() database.Column {
	return database.NewColumn(m.tableName, "updated_at")
}

func (m projectMeta) qualifiedTableName() string { return m.tableName }

var _ updatable = (*projectMeta)(nil)
var _ deletable = (*projectMeta)(nil)

// ProjectRepository implements [domain.ProjectRepository].
type ProjectRepository struct {
	meta projectMeta
	now  database.Instruction
}

var _ domain.ProjectRepository = (*ProjectRepository)(nil)

// NewProjectRepository returns a dialect-specific [ProjectRepository].
func NewProjectRepository(client database.QueryExecutor) *ProjectRepository {
	switch client.(type) {
	case spanner.SpannerPooler:
		return &ProjectRepository{
			meta: projectMeta{tableName: spannerTableProjects},
			now:  database.CurrentTimestampInstruction,
		}
	case postgres.PostgresPooler:
		return &ProjectRepository{
			meta: projectMeta{tableName: pgTableProjects},
			now:  database.NowInstruction,
		}
	}
	panic("NewProjectRepository: unsupported client type")
}

func (r *ProjectRepository) Create(ctx context.Context, client database.QueryExecutor, project *domain.Project) error {
	b := database.NewStatementBuilder("INSERT INTO ")
	b.WriteString(r.meta.tableName)
	b.WriteString(" (id, created_at, updated_at) VALUES (")
	b.WriteArg(project.ID)
	b.WriteString(", ")
	b.WriteArg(r.now)
	b.WriteString(", ")
	b.WriteArg(r.now)
	b.WriteString(")")
	_, err := client.Exec(ctx, b.String(), b.Args()...)
	return err
}

func (r *ProjectRepository) Get(ctx context.Context, client database.QueryExecutor, id string) (*domain.Project, error) {
	b := database.NewStatementBuilder("SELECT id, created_at, updated_at FROM ")
	b.WriteString(r.meta.tableName)
	b.WriteString(" WHERE id = ")
	b.WriteArg(id)
	row, err := getOne[projectRow](ctx, client, b)
	if err != nil {
		return nil, err
	}
	return &domain.Project{ID: row.ID, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt}, nil
}
