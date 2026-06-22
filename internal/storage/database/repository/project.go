package repository

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
)

const pgTableProjects = "zitadel_nextgen.projects"
const spannerTableProjects = "projects"

type projectRow struct {
	ID             string         `db:"id"`
	CreatedAt      time.Time      `db:"created_at"`
	UpdatedAt      time.Time      `db:"updated_at"`
	ProjectSecret  string         `db:"project_secret"`
	PreviewSecret  string         `db:"preview_secret"`
	PreviewOrigins previewOrigins `db:"preview_origins"`
}

// previewOrigins scans preview_origins from Postgres text[] and Spanner JSON strings.
type previewOrigins []string

func (p *previewOrigins) Scan(src any) error {
	if src == nil {
		*p = previewOrigins{}
		return nil
	}
	switch v := src.(type) {
	case string:
		if v == "" || v == "{}" {
			*p = previewOrigins{}
			return nil
		}
		if strings.HasPrefix(v, "[") {
			return json.Unmarshal([]byte(v), p)
		}
		var sa StringArray
		if err := sa.scanString(v); err != nil {
			return err
		}
		*p = previewOrigins(sa)
		return nil
	default:
		var sa StringArray
		if err := sa.Scan(src); err != nil {
			return err
		}
		*p = previewOrigins(sa)
		return nil
	}
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
	meta                 projectMeta
	now                  database.Instruction
	encodePreviewOrigins func([]string) any
}

var _ domain.ProjectRepository = (*ProjectRepository)(nil)

// NewProjectRepository returns a dialect-specific [ProjectRepository].
func NewProjectRepository(client database.QueryExecutor) *ProjectRepository {
	switch client.(type) {
	case spanner.SpannerPooler:
		return &ProjectRepository{
			meta: projectMeta{tableName: spannerTableProjects},
			now:  database.CurrentTimestampInstruction,
			encodePreviewOrigins: func(origins []string) any {
				encoded, err := json.Marshal(origins)
				if err != nil {
					panic(err)
				}
				return string(encoded)
			},
		}
	case postgres.PostgresPooler:
		return &ProjectRepository{
			meta: projectMeta{tableName: pgTableProjects},
			now:  database.NowInstruction,
			encodePreviewOrigins: func(origins []string) any {
				return StringArray(origins)
			},
		}
	}
	panic("NewProjectRepository: unsupported client type")
}

func (r *ProjectRepository) Create(ctx context.Context, client database.QueryExecutor, project *domain.Project) error {
	if project.ID == "" {
		return errors.New("project ID must not be empty")
	}
	origins := project.PreviewOrigins
	if origins == nil {
		origins = []string{}
	}

	b := database.NewStatementBuilder("INSERT INTO ")
	b.WriteString(r.meta.tableName)
	b.WriteString(" (id, project_secret, preview_secret, preview_origins, created_at, updated_at) VALUES (")
	b.WriteArg(project.ID)
	b.WriteString(", ")
	b.WriteArg(project.ProjectSecret)
	b.WriteString(", ")
	b.WriteArg(project.PreviewSecret)
	b.WriteString(", ")
	b.WriteArg(r.encodePreviewOrigins(origins))
	b.WriteString(", ")
	b.WriteArg(r.now)
	b.WriteString(", ")
	b.WriteArg(r.now)
	b.WriteString(")")

	_, err := client.Exec(ctx, b.String(), b.Args()...)
	return err
}

func (r *ProjectRepository) Get(ctx context.Context, client database.QueryExecutor, id string) (*domain.Project, error) {
	b := database.NewStatementBuilder("SELECT id, created_at, updated_at, project_secret, preview_secret, preview_origins FROM ")
	b.WriteString(r.meta.tableName)
	b.WriteString(" WHERE id = ")
	b.WriteArg(id)

	row, err := getOne[projectRow](ctx, client, b)
	if err != nil {
		return nil, err
	}
	return rowToProject(*row), nil
}

func rowToProject(row projectRow) *domain.Project {
	return &domain.Project{
		ID:             row.ID,
		CreatedAt:      row.CreatedAt,
		UpdatedAt:      row.UpdatedAt,
		ProjectSecret:  row.ProjectSecret,
		PreviewSecret:  row.PreviewSecret,
		PreviewOrigins: []string(row.PreviewOrigins),
	}
}
