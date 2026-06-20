package spanner

import (
	"cloud.google.com/go/spanner"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type projectStatements statement

func newProjectStatements(client queryExecutor) projectStatements {
	return projectStatements{
		client: client,
	}
}

// CreateProject implements [database.ProjectStatements].
func (s projectStatements) CreateProject(project *domain.Project) database.Execution {
	return &execution{
		client: s.client,
		stmt: spanner.Statement{
			SQL: `INSERT INTO projects (id, project_secret, preview_secret, preview_origins) VALUES (@id, @project_secret, @preview_secret, @preview_origins) THEN RETURN created_at, updated_at`,
			Params: map[string]any{
				"id":              project.ID,
				"project_secret":  project.ProjectSecret,
				"preview_secret":  project.PreviewSecret,
				"preview_origins": project.PreviewOrigins,
			},
		},
		scan: func(iter *spanner.RowIterator) error {
			return iter.Do(func(row *spanner.Row) error {
				return row.Columns(&project.CreatedAt, &project.UpdatedAt)
			})
		},
	}
}

// DeleteProjectByID implements [database.ProjectStatements].
func (s projectStatements) DeleteProjectByID(id string) database.Execution {
	return &execution{
		client: s.client,
		stmt: spanner.Statement{
			SQL: `DELETE FROM projects WHERE id = @id`,
			Params: map[string]any{
				"id": id,
			},
		},
	}
}

// GetProjectByID implements [database.ProjectStatements].
func (s projectStatements) GetProjectByID(id string) database.Query[domain.Project] {
	panic("unimplemented")
}

// ListProjects implements [database.ProjectStatements].
func (s projectStatements) ListProjects(filter *database.ListOptions) database.Query[database.ListResult[*domain.Project]] {
	panic("unimplemented")
}

var _ service.ProjectStatements = (*projectStatements)(nil)
