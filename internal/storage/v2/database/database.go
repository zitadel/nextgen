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

// Statementer collects all statement methods for the domain entities.
// It is used by the service layer to execute database operations.
// The service layer methods can still define smaller interfaces to fulfill their needs.
// This interface might not strictly be needed, therefore look at it as a documentation part of the spike.
type Statementer interface {
	CreateProject(entity *domain.Project) Execution
	GetProjectByID(id string) Query[*domain.Project]
	ListProjects(filter *ListOptions) Query[*ListResult[*domain.Project]]
	DeleteProjectByID(id string) Execution

	CreateFlowDefinition(entity *domain.FlowDefinition) Execution
	GetFlowDefinitionByID(id string) Query[*domain.FlowDefinition]
	ListFlowDefinitions(filter *ListOptions) Query[*ListResult[*domain.FlowDefinition]]
	DeleteFlowDefinitionByID(id string) Execution
}

type Execution interface {
	Execute(ctx context.Context) error
}

type Query[R any] interface {
	Execution
	Result() R
}
