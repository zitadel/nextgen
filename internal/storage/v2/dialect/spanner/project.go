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

const createProjectStmt = `INSERT INTO projects (id, project_secret, preview_secret, preview_origins) VALUES (@p1, @p2, @p3, @p4) THEN RETURN id, created_at, updated_at`

type projectStatements struct{ statement }

func newProjectStatements(client queryExecutor) projectStatements {
	return projectStatements{
		statement: statement{
			client: client,
		},
	}
}

// CreateProject implements [service.ProjectStatements].
func (ps projectStatements) CreateProject(ctx context.Context, project *domain.Project) error {
	previewOrigins, err := encodePreviewOrigins(project.PreviewOrigins)
	if err != nil {
		return wrapError(err)
	}
	return ps.client.QueryRow(ctx, createProjectStmt, project.ID, project.ProjectSecret, project.PreviewSecret, previewOrigins).
		Scan(&project.ID, &project.CreatedAt, &project.UpdatedAt)
}

const deleteByIDProjectStmt = `DELETE FROM projects WHERE id = @p1`

// DeleteProjectByID implements [service.ProjectStatements].
func (ps projectStatements) DeleteProjectByID(ctx context.Context, id string) error {
	_, err := ps.client.Exec(ctx, deleteByIDProjectStmt, id)
	return err
}

const projectQuery = "SELECT id, created_at, updated_at, project_secret, preview_secret, preview_origins FROM projects"

// GetProjectByID implements [service.ProjectStatements].
func (ps projectStatements) GetProjectByID(ctx context.Context, id string) (*domain.Project, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, projectQuery, &database.ListOptions[domain.ProjectField]{
		Filter: database.Equal(database.Col(domain.ProjectFieldID), id),
	}, projectSchema); err != nil {
		return nil, err
	}

	rows, err := ps.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	return collectExactlyOneRow(rows, ps.scanProject)
}

// ListProjects implements [service.ProjectStatements].
func (ps projectStatements) ListProjects(ctx context.Context, filter *database.ListOptions[domain.ProjectField]) (*database.ListResult[*domain.Project], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, projectQuery, filter, projectSchema); err != nil {
		return nil, err
	}

	rows, err := ps.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}

	projects, err := collectRows(rows, ps.scanProject)
	if err != nil {
		return nil, err
	}

	var nextCursor []byte
	if filter.Pagination.Limit > 0 && len(projects) == int(filter.Pagination.Limit) {
		curser := &pagination.Cursor[domain.ProjectField]{
			Columns: filter.Pagination.OrderBy.Columns,
			Values:  projectSchema.ValuesFrom(projects[len(projects)-1], filter.Pagination.OrderBy.Columns),
		}
		nextCursor = curser.Marshal()
	}

	return &database.ListResult[*domain.Project]{
		Items:      projects,
		NextCursor: nextCursor,
	}, nil
}

func (ps projectStatements) scanProject(row *spanner.Row) (*domain.Project, error) {
	project := new(domain.Project)
	var previewOriginsJSON string
	if err := row.Columns(&project.ID, &project.CreatedAt, &project.UpdatedAt, &project.ProjectSecret, &project.PreviewSecret, &previewOriginsJSON); err != nil {
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
	domain.ProjectFieldProjectSecret: {
		SQLName:  "project_secret",
		Accessor: func(p *domain.Project) any { return p.ProjectSecret },
		Coerce:   database.CoerceString,
	},
	domain.ProjectFieldPreviewSecret: {
		SQLName:  "preview_secret",
		Accessor: func(p *domain.Project) any { return p.PreviewSecret },
		Coerce:   database.CoerceString,
	},
	domain.ProjectFieldPreviewOrigins: {
		SQLName:  "preview_origins",
		Accessor: func(p *domain.Project) any { return p.PreviewOrigins },
		Coerce:   database.CoerceSliceAsAny(database.CoerceStringValue),
	},
})
