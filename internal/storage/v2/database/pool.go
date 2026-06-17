package database

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/query"
	"github.com/zitadel/nextgen/internal/storage/v2/query/flowdefinition"
)

// Pool is a connection pool with typed statement access.
type Pool interface {
	Transactional
	Statementer
}

// Transactional runs a callback inside a database transaction.
type Transactional interface {
	Transaction(ctx context.Context, fn func(ctx context.Context, tx Statementer) error) error
}

// Statementer exposes typed statement groups.
type Statementer interface {
	FlowDefinition() FlowDefinitionStatements
}

// Execution runs a statement that does not return a typed result.
type Execution interface {
	Execute(ctx context.Context) error
}

// Query runs a statement and returns a typed result.
type Query[R any] interface {
	Execute(ctx context.Context) (R, error)
}

// FlowDefinitionListOptions is a convenience alias for flow definition list queries.
type FlowDefinitionListOptions = query.ListOptions[flowdefinition.Column]

// FlowDefinitionListResult is a convenience alias for flow definition list results.
type FlowDefinitionListResult = query.ListResult[*domain.FlowDefinition]
