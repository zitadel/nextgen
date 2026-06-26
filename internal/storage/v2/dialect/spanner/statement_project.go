package spanner

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type projectStatements struct{ statement }

// CreateProject implements [service.ProjectStatements].
func (p projectStatements) CreateProject(ctx context.Context, entity *domain.Project) error {
	panic("unimplemented")
}

// DeleteProjectByID implements [service.ProjectStatements].
func (p projectStatements) DeleteProjectByID(ctx context.Context, id string) error {
	panic("unimplemented")
}

// GetProjectByID implements [service.ProjectStatements].
func (p projectStatements) GetProjectByID(ctx context.Context, id string) (*domain.Project, error) {
	panic("unimplemented")
}

// IsStatements implements [service.ProjectStatements].
// Subtle: this method shadows the method (statement).IsStatements of projectStatements.statement.
func (p projectStatements) IsStatements() {
	panic("unimplemented")
}

// ListProjects implements [service.ProjectStatements].
func (p projectStatements) ListProjects(ctx context.Context, filter *database.ListOptions[domain.ProjectField]) (*database.ListResult[*domain.Project], error) {
	panic("unimplemented")
}

func newProjectStatements(client queryExecutor) projectStatements {
	return projectStatements{
		statement: statement{
			client: client,
		},
	}
}

var _ service.ProjectStatements = (*projectStatements)(nil)
