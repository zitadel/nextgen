package service

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type StatementPool interface {
	Statementer[AllStatements]
	Transactioner[AllStatements]
}

type Statements interface {
	IsStatements()
}

type AllStatements interface {
	ProjectStatements
	FlowDefinitionStatements
	Statements
}

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type ProjectPool interface {
// 	Statementer[ProjectStatements]
// 	Transactioner[ProjectStatements]
// }

type ProjectStatements interface {
	Statements
	CreateProject(entity *domain.Project) database.Execution
	GetProjectByID(id string) database.Query[domain.Project]
	ListProjects(filter *database.ListOptions) database.Query[database.ListResult[*domain.Project]]
	DeleteProjectByID(id string) database.Execution
}

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type FlowDefinitionPool interface {
// 	Statementer[FlowDefinitionStatements]
// 	Transactioner[FlowDefinitionStatements]
// }

type FlowDefinitionStatements interface {
	Statements
	CreateFlowDefinition(entity *domain.FlowDefinition) database.Execution
	GetFlowDefinitionByID(id string) database.Query[domain.FlowDefinition]
	ListFlowDefinitions(filter *database.ListOptions) database.Query[database.ListResult[*domain.FlowDefinition]]
	DeleteFlowDefinitionByID(id string) database.Execution
}
