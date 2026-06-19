package service

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func test() {
	var d database.Dialect
	p, _ := d.Connect(context.TODO())
	stmtPool := database.PoolAs[StatementPool](p)
	stmtPool.Transaction(context.TODO(), func(ctx context.Context, tx Statements) error {
		tx.CreateProject(nil)
		return nil
	})
	stmtPool.CreateProject(nil)

	projectPool := database.PoolAs[ProjectPool](p)
	projectPool.CreateProject(nil)
	projectPool.Transaction(context.TODO(), func(ctx context.Context, ps ProjectStatements) error {
		ps.CreateProject(nil)
		return nil
	})
}

type StatementPool interface {
	database.TypedTransactional[Statements]
	Statements
}

type Statements interface {
	ProjectStatements
	FlowDefinitionStatements
}

type ProjectPool interface {
	database.TypedTransactional[ProjectStatements]
	ProjectStatements
}

type ProjectStatements interface {
	CreateProject(entity *domain.Project) database.Execution
	GetProjectByID(id string) database.Query[*domain.Project]
	ListProjects(filter *database.ListOptions) database.Query[*database.ListResult[*domain.Project]]
	DeleteProjectByID(id string) database.Execution
}

type FlowDefinitionPool interface {
	database.TypedTransactional[FlowDefinitionStatements]
	FlowDefinitionStatements
}

type FlowDefinitionStatements interface {
	CreateFlowDefinition(entity *domain.FlowDefinition) database.Execution
	GetFlowDefinitionByID(id string) database.Query[*domain.FlowDefinition]
	ListFlowDefinitions(filter *database.ListOptions) database.Query[*database.ListResult[*domain.FlowDefinition]]
	DeleteFlowDefinitionByID(id string) database.Execution
}
