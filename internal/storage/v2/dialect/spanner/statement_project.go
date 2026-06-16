package spanner

import (
	"cloud.google.com/go/spanner"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// CreateProject implements [database.ProjectStatements].
func (s statements) CreateProject(project *domain.Project) database.Execution {
	c := &spanner.Client{}
	stmt := spanner.Statement{
		SQL: `INSERT INTO projects (id, project_secret, preview_secret, preview_origins) VALUES (@id, @project_secret, @preview_secret, @preview_origins) THEN RETURN created_at, updated_at`,
		Params: map[string]interface{}{
			"id":              project.ID,
			"project_secret":  project.ProjectSecret,
			"preview_secret":  project.PreviewSecret,
			"preview_origins": project.PreviewOrigins,
		},
	}
}

// DeleteProjectByID implements [database.ProjectStatements].
func (s statements) DeleteProjectByID(id string) database.Execution {
	panic("unimplemented")
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
