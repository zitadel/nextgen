package spanner

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// CreateFlowDefinition implements [database.FlowDefinitionStatements].
func (s statements) CreateFlowDefinition(flowDef *domain.FlowDefinition) database.Execution {
	panic("unimplemented")
}

// DeleteFlowDefinitionByID implements [database.FlowDefinitionStatements].
func (s statements) DeleteFlowDefinitionByID(id string) database.Execution {
	panic("unimplemented")
}

// GetFlowDefinitionByID implements [database.FlowDefinitionStatements].
func (s statements) GetFlowDefinitionByID(id string) database.Query[*domain.FlowDefinition] {
	panic("unimplemented")
}

// ListFlowDefinitions implements [database.FlowDefinitionStatements].
func (s statements) ListFlowDefinitions(filter database.ListOptions[domain.FlowDefinitionField]) database.Query[[]*domain.FlowDefinition] {
	panic("unimplemented")
}
