package service

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type StatementPool interface {
	database.TypedPool[Statements]
	Statements
}

type Statements interface {
	ProjectStatements
	FlowDefinitionStatements
}

type ProjectPool interface {
	database.TypedPool[ProjectStatements]
	ProjectStatements
}

type ProjectStatements interface {
	CreateProject(entity *domain.Project) database.Execution
	GetProjectByID(id string) database.Query[domain.Project]
	ListProjects(filter *database.ListOptions) database.Query[database.ListResult[*domain.Project]]
	DeleteProjectByID(id string) database.Execution
}

type FlowDefinitionPool interface {
	database.TypedPool[FlowDefinitionStatements]
	FlowDefinitionStatements
}

type FlowDefinitionStatements interface {
	CreateFlowDefinition(entity *domain.FlowDefinition) database.Execution
	GetFlowDefinitionByID(id string) database.Query[domain.FlowDefinition]
	ListFlowDefinitions(filter *database.ListOptions) database.Query[database.ListResult[*domain.FlowDefinition]]
	DeleteFlowDefinitionByID(id string) database.Execution
}
