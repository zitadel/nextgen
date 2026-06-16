package postgres

import (
	"github.com/jackc/pgx/v5"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

const createProjectStmt = `INSERT INTO zitadel_nextgen.projects (id, created_at, updated_at, project_secret, preview_secret, preview_origins) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at, updated_at`

// CreateProject implements [database.ProjectStatements].
func (s statements) CreateProject(project *domain.Project) database.Execution {
	return &execution{
		client: s.client,
		stmt:   createProjectStmt,
		args: []any{
			project.ID,
			project.CreatedAt,
			project.UpdatedAt,
			project.ProjectSecret,
			project.PreviewSecret,
			project.PreviewOrigins,
		},
		scan: func(rows pgx.Rows) error {
			return rows.Scan(&project.ID, &project.CreatedAt, &project.UpdatedAt)
		},
	}
}

const deleteByIDProjectStmt = `DELETE FROM zitadel_nextgen.projects WHERE id = $1`

// DeleteProjectByID implements [database.ProjectStatements].
func (s statements) DeleteProjectByID(id string) database.Execution {
	return &execution{
		client: s.client,
		stmt:   deleteByIDProjectStmt,
		args:   []any{id},
	}
}

// GetProjectByID implements [database.ProjectStatements].
func (s statements) GetProjectByID(id string) database.Query[*domain.Project] {
	panic("unimplemented")
}

// ListProjects implements [database.ProjectStatements].
func (s statements) ListProjects(filter database.Filter) database.Query[[]*domain.Project] {
	panic("unimplemented")
}

var _ database.ProjectStatements = (*statements)(nil)
