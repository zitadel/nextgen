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
	ID             string            `db:"id"`
	CreatedAt      time.Time         `db:"created_at"`
	UpdatedAt      time.Time         `db:"updated_at"`
	ProjectSecret  string            `db:"project_secret"`
	PreviewSecret  string            `db:"preview_secret"`
	PreviewOrigins JSONArray[string] `db:"preview_origins"`
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
	// return r.v2.CreateProject(project).Execute(ctx)
	return nil
}

func (r *ProjectRepository) Get(ctx context.Context, client database.QueryExecutor, id string) (*domain.Project, error) {
	// stmt := r.v2.GetProjectByID(id)
	// if err := stmt.Execute(ctx); err != nil {
	// 	return nil, err
	// }
	// return stmt.Result(), nil
	return nil, nil
}
