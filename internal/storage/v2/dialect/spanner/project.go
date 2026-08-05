package spanner

import (
	"context"
	"encoding/json"

	"cloud.google.com/go/spanner"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
)

const (
	projectsTable         = "projects"
	createProjectStmt     = `INSERT INTO projects (id, name, preview_origins) VALUES (@p1, @p2, @p3) THEN RETURN id, created_at, updated_at`
	updateProjectStmt     = `UPDATE projects SET name = @p2, updated_at = CURRENT_TIMESTAMP() WHERE id = @p1 THEN RETURN id, name, preview_origins, created_at, updated_at`
	deleteByIDProjectStmt = `DELETE FROM projects WHERE id = @p1`
	projectQuery          = "SELECT id, name, preview_origins, created_at, updated_at FROM projects"
)

var projectColumns = []string{
	"id", "name", "preview_origins", "created_at", "updated_at",
}

type projectStatements struct{ statement }

func newProjectStatements(db queryExecutor) projectStatements {
	return projectStatements{
		statement: statement{
			db: db,
		},
	}
}

// CreateProject implements [service.ProjectStatements].
func (ps projectStatements) CreateProject(ctx context.Context, project *domain.Project) error {
	if err := ensureManagedID(&project.ID, domain.PrefixProject); err != nil {
		return err
	}
	previewOrigins, err := encodePreviewOrigins(project.PreviewOrigins)
	if err != nil {
		return wrapError(err)
	}
	stmt := buildStatement(createProjectStmt, project.ID, project.Name, previewOrigins).statement()
	return ps.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&project.ID, &project.CreatedAt, &project.UpdatedAt)
		})
		return err
	})
}

// DeleteProjectByID implements [service.ProjectStatements].
func (ps projectStatements) DeleteProjectByID(ctx context.Context, id string) error {
	stmt := buildStatement(deleteByIDProjectStmt, id).statement()
	_, err := ps.db.Update(ctx, stmt)
	return err
}

// GetProjectByID implements [service.ProjectStatements].
func (ps projectStatements) GetProjectByID(ctx context.Context, id string) (*domain.Project, error) {
	row, err := ps.db.ReadRow(ctx, projectsTable, spanner.Key{id}, projectColumns)
	if err != nil {
		return nil, err
	}
	return ps.scanProject(row)
}

// UpdateProject implements [service.ProjectStatements].
// Only the name is updated; preview origins are left untouched. The whole row is
// read back onto the project.
func (ps projectStatements) UpdateProject(ctx context.Context, project *domain.Project) error {
	stmt := buildStatement(updateProjectStmt, project.ID, project.Name).statement()
	return ps.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		updated, err := collectOneRow(iter, ps.scanProject)
		if err != nil {
			return err
		}
		*project = *updated
		return nil
	})
}

// ListProjects implements [service.ProjectStatements].
func (ps projectStatements) ListProjects(ctx context.Context, filter *database.ListOptions[domain.ProjectField]) (*database.ListResult[*domain.Project], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, projectQuery, filter, projectSchema); err != nil {
		return nil, err
	}

	var projects []*domain.Project
	err := ps.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		projects, err = collectRows(iter, ps.scanProject)
		return err
	})
	if err != nil {
		return nil, err
	}

	var nextCursor []byte
	if filter.Pagination.Limit > 0 && len(projects) == int(filter.Pagination.Limit) {
		cursor := &pagination.Cursor[domain.ProjectField]{
			Columns: filter.Pagination.OrderBy.Columns,
			Values:  projectSchema.ValuesFrom(projects[len(projects)-1], filter.Pagination.OrderBy.Columns),
		}
		nextCursor = cursor.Marshal()
	}

	return &database.ListResult[*domain.Project]{
		Items:      projects,
		NextCursor: nextCursor,
	}, nil
}

func (ps projectStatements) scanProject(row *spanner.Row) (*domain.Project, error) {
	project := new(domain.Project)
	var previewOriginsJSON string
	if err := row.Columns(&project.ID, &project.Name, &previewOriginsJSON, &project.CreatedAt, &project.UpdatedAt); err != nil {
		return nil, err
	}
	origins, err := decodePreviewOrigins(previewOriginsJSON)
	if err != nil {
		return nil, err
	}
	project.PreviewOrigins = origins
	return project, nil
}

func encodePreviewOrigins(origins []string) (string, error) {
	if origins == nil {
		origins = []string{}
	}
	data, err := json.Marshal(origins)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func decodePreviewOrigins(value string) ([]string, error) {
	if value == "" {
		return []string{}, nil
	}
	var origins []string
	if err := json.Unmarshal([]byte(value), &origins); err != nil {
		return nil, err
	}
	return origins, nil
}

var _ service.ProjectStatements = (*projectStatements)(nil)

var projectSchema = database.NewSchema(map[domain.ProjectField]database.FieldBinding[domain.Project]{
	domain.ProjectFieldID: {
		SQLName:  "id",
		Accessor: func(p *domain.Project) any { return p.ID },
		Coerce:   database.CoerceString,
	},
	domain.ProjectFieldName: {
		SQLName:  "name",
		Accessor: func(p *domain.Project) any { return p.Name },
		Coerce:   database.CoerceString,
	},
	domain.ProjectFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(p *domain.Project) any { return p.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.ProjectFieldUpdatedAt: {
		SQLName:  "updated_at",
		Accessor: func(p *domain.Project) any { return p.UpdatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.ProjectFieldPreviewOrigins: {
		SQLName:  "preview_origins",
		Accessor: func(p *domain.Project) any { return p.PreviewOrigins },
		Coerce:   database.CoerceSliceAsAny(database.CoerceStringValue),
	},
})
