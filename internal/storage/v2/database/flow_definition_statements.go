package database

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/query"
	"github.com/zitadel/nextgen/internal/storage/v2/query/flowdefinition"
)

// FlowDefinitionStatements provides typed flow definition storage operations.
type FlowDefinitionStatements interface {
	Create(def *domain.FlowDefinition) Execution
	GetByID(projectID, id string) Query[*domain.FlowDefinition]
	List(opts query.ListOptions[flowdefinition.Column]) Query[query.ListResult[*domain.FlowDefinition]]
	UpdateStatus(projectID, id string, status domain.FlowDefinitionStatus) Execution
	Delete(projectID, id string) Execution
}
