package postgres

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type flowDefinitionStatements statement

func newFlowDefinitionStatements(client queryExecutor) flowDefinitionStatements {
	return flowDefinitionStatements{client: client}
}

// CreateFlowDefinition implements [database.FlowDefinitionStatements].
func (s flowDefinitionStatements) CreateFlowDefinition(flowDef *domain.FlowDefinition) database.Execution {
	panic("unimplemented")
}

// DeleteFlowDefinitionByID implements [database.FlowDefinitionStatements].
func (s flowDefinitionStatements) DeleteFlowDefinitionByID(id string) database.Execution {
	panic("unimplemented")
}

// GetFlowDefinitionByID implements [database.FlowDefinitionStatements].
func (s flowDefinitionStatements) GetFlowDefinitionByID(id string) database.Query[*domain.FlowDefinition] {
	panic("unimplemented")
}

// ListFlowDefinitions implements [database.FlowDefinitionStatements].
func (s flowDefinitionStatements) ListFlowDefinitions(filter *database.ListOptions) database.Query[*database.ListResult[*domain.FlowDefinition]] {
	panic("unimplemented")
}
