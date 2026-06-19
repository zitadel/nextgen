package service

// import (
// 	"github.com/zitadel/nextgen/internal/domain"
// 	"github.com/zitadel/nextgen/internal/storage/v2/database"
// )

// // Statementer collects all statement methods for the domain entities.
// // It is used by the service layer to execute database operations.
// // The service layer methods can still define smaller interfaces to fulfill their needs.
// // This interface might not strictly be needed, therefore look at it as a documentation part of the spike.
// type Statementer interface {
// 	CreateProject(entity *domain.Project) database.Execution
// 	GetProjectByID(id string) database.Query[*domain.Project]
// 	ListProjects(filter *database.ListOptions) database.Query[*database.ListResult[*domain.Project]]
// 	DeleteProjectByID(id string) database.Execution

// 	CreateFlowDefinition(entity *domain.FlowDefinition) database.Execution
// 	GetFlowDefinitionByID(id string) database.Query[*domain.FlowDefinition]
// 	ListFlowDefinitions(filter *database.ListOptions) database.Query[*database.ListResult[*domain.FlowDefinition]]
// 	DeleteFlowDefinitionByID(id string) database.Execution
// }
