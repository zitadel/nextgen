package postgres

import (
	"github.com/jackc/pgx/v5"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

const createProjectStmt = `INSERT INTO zitadel_nextgen.projects (id, project_secret, preview_secret, preview_origins) VALUES ($1, $2, $3, $4) RETURNING id, created_at, updated_at`

type projectStatements statement

func newProjectStatements(client queryExecutor) projectStatements {
	return projectStatements{client: client}
}

// CreateProject implements [database.ProjectStatements].
func (ps projectStatements) CreateProject(project *domain.Project) database.Execution {
	return &query[domain.Project]{
		execution: execution{
			client: ps.client,
			stmt:   createProjectStmt,
			args: []any{
				project.ID,
				project.ProjectSecret,
				project.PreviewSecret,
				project.PreviewOrigins,
			},
		},
		scan: func(rows pgx.Rows, result *domain.Project) error {
			_, err := pgx.CollectOneRow(rows, func(row pgx.CollectableRow) (*domain.Project, error) {
				return project, row.Scan(&project.ID, &project.CreatedAt, &project.UpdatedAt)
			})
			return err
		},
	}
}

const deleteByIDProjectStmt = `DELETE FROM zitadel_nextgen.projects WHERE id = $1`

// DeleteProjectByID implements [database.ProjectStatements].
func (ps projectStatements) DeleteProjectByID(id string) database.Execution {
	return &execution{
		client: ps.client,
		stmt:   deleteByIDProjectStmt,
		args:   []any{id},
	}
}

const projectQuery = "SELECT id, created_at, updated_at, project_secret, preview_secret, preview_origins FROM zitadel_nextgen.projects"

// GetProjectByID implements [database.ProjectStatements].
func (ps projectStatements) GetProjectByID(id string) database.Query[domain.Project] {
	var compiler statementCompiler
	compiler.compileRead(projectQuery, &database.ListOptions{
		Filter: database.Equal(database.Column(domain.ProjectFieldID), id),
	})

	return &query[domain.Project]{
		execution: execution{
			client: ps.client,
			stmt:   compiler.String(),
			args:   compiler.args,
		},
		scan: ps.scanProject,
	}
}

// ListProjects implements [database.ProjectStatements].
func (ps projectStatements) ListProjects(filter *database.ListOptions) database.Query[database.ListResult[*domain.Project]] {
	var compiler statementCompiler
	compiler.compileRead(projectQuery, filter)

	return &query[database.ListResult[*domain.Project]]{
		execution: execution{
			client: ps.client,
			stmt:   compiler.String(),
			args:   compiler.args,
		},
		scan: ps.scanProjects,
		result: &database.ListResult[*domain.Project]{
			NextCursor: &database.CursorToken{
				Limit:   filter.Pagination.Limit,
				OrderBy: filter.Pagination.OrderBy,
			},
		},
	}
}

func (ps projectStatements) scanProjects(rows pgx.Rows, result *database.ListResult[*domain.Project]) error {
	projects, err := pgx.CollectRows(rows, ps.scan)
	if err != nil {
		return err
	}
	result.Items = projects

	for _, column := range result.NextCursor.OrderBy.Columns {
		switch column {
		case database.Column(domain.ProjectFieldID):
			result.NextCursor.Values = append(result.NextCursor.Values, projects[len(projects)-1].ID)
		case database.Column(domain.ProjectFieldCreatedAt):
			result.NextCursor.Values = append(result.NextCursor.Values, projects[len(projects)-1].CreatedAt)
		case database.Column(domain.ProjectFieldUpdatedAt):
			result.NextCursor.Values = append(result.NextCursor.Values, projects[len(projects)-1].UpdatedAt)
		case database.Column(domain.ProjectFieldProjectSecret):
			result.NextCursor.Values = append(result.NextCursor.Values, projects[len(projects)-1].ProjectSecret)
		case database.Column(domain.ProjectFieldPreviewSecret):
			result.NextCursor.Values = append(result.NextCursor.Values, projects[len(projects)-1].PreviewSecret)
		case database.Column(domain.ProjectFieldPreviewOrigins):
			result.NextCursor.Values = append(result.NextCursor.Values, projects[len(projects)-1].PreviewOrigins)
		}
	}

	return nil
}

func (ps projectStatements) scanProject(rows pgx.Rows, result *domain.Project) error {
	res, err := pgx.CollectExactlyOneRow(rows, ps.scan)
	if err != nil {
		return err
	}
	*result = *res
	return nil
}

func (ps projectStatements) scan(row pgx.CollectableRow) (*domain.Project, error) {
	project := new(domain.Project)
	if err := row.Scan(&project.ID, &project.CreatedAt, &project.UpdatedAt, &project.ProjectSecret, &project.PreviewSecret, &project.PreviewOrigins); err != nil {
		return nil, err
	}
	return project, nil
}
