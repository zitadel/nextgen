package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
)

const createProjectStmt = `INSERT INTO zitadel_nextgen.projects (id, name, preview_origins) VALUES ($1, $2, $3) RETURNING id, created_at, updated_at`

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
	return ps.client.QueryRow(ctx, createProjectStmt, project.ID, project.Name, project.PreviewOrigins).
		Scan(&project.ID, &project.CreatedAt, &project.UpdatedAt)
}

const deleteByIDProjectStmt = `DELETE FROM zitadel_nextgen.projects WHERE id = $1`

// DeleteProjectByID implements [service.ProjectStatements].
func (ps projectStatements) DeleteProjectByID(ctx context.Context, id string) error {
	_, err := ps.client.Exec(ctx, deleteByIDProjectStmt, id)
	return err
}

const projectQuery = "SELECT id, name, created_at, updated_at, preview_origins FROM zitadel_nextgen.projects"

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
	project, err := pgx.CollectExactlyOneRow(rows, ps.scanProject)
	if err != nil {
		return nil, wrapError(err)
	}
	return project, nil
}

const updateProjectStmt = `UPDATE zitadel_nextgen.projects SET name = $2, updated_at = now() WHERE id = $1 RETURNING updated_at`

// UpdateProject implements [service.ProjectStatements].
// Only name is updated; secrets and preview origins are left untouched.
// updated_at is refreshed and read back onto project.
func (ps projectStatements) UpdateProject(ctx context.Context, project *domain.Project) error {
	return wrapError(ps.client.QueryRow(ctx, updateProjectStmt, project.ID, project.Name).
		Scan(&project.UpdatedAt))
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

	projects, err := pgx.CollectRows(rows, ps.scanProject)
	if err != nil {
		return nil, wrapError(err)
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

func (ps projectStatements) scanProject(row pgx.CollectableRow) (*domain.Project, error) {
	project := new(domain.Project)
	if err := row.Scan(&project.ID, &project.Name, &project.CreatedAt, &project.UpdatedAt, &project.PreviewOrigins); err != nil {
		return nil, err
	}
	return project, nil
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
