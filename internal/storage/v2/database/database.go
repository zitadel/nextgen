package database

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
)

// Pool is a connection pool. e.g. pgxpool
type Pool interface {
	Transactional
	Statementer

	Acquire(ctx context.Context) (Connection, error)
	Close(ctx context.Context) error

	Ping(ctx context.Context) error
}

// Connection is a single database connection which can be released back to the pool.
type Connection interface {
	Transactional
	Statementer

	Release(ctx context.Context) error

	Ping(ctx context.Context) error
}

type Transactional interface {
	Transaction(ctx context.Context, fn func(ctx context.Context, tx Statementer) error) error
}

type Statementer interface {
	Project() ProjectStatements
	FlowDefinition() FlowDefinitionStatements
}

type ProjectStatements interface {
	CreateProject(project *domain.Project) Execution
	GetProjectByID(id string) Query[*domain.Project]
	ListProjects(filter Filter) Query[[]*domain.Project]
	DeleteProjectByID(id string) Execution
}

type FlowDefinitionStatements interface {
	CreateFlowDefinition(flowDef *domain.FlowDefinition) Execution
	GetFlowDefinitionByID(id string) Query[*domain.FlowDefinition]
	ListFlowDefinitions(filter Filter) Query[[]*domain.FlowDefinition]
	DeleteFlowDefinitionByID(id string) Execution
}

type Execution interface {
	Execute(ctx context.Context) error
}

type Query[R any] interface {
	Execute(ctx context.Context) (R, error)
}
