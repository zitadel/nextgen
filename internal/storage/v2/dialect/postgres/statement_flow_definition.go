package postgres

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type flowDefinitionStatements struct{ statement }

// CreateFlowDefinition implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) CreateFlowDefinition(ctx context.Context, entity *domain.FlowDefinition) error {
	panic("unimplemented")
}

// DeleteFlowDefinitionByID implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) DeleteFlowDefinitionByID(ctx context.Context, id string) error {
	panic("unimplemented")
}

// GetFlowDefinitionByID implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) GetFlowDefinitionByID(ctx context.Context, id string) (*domain.FlowDefinition, error) {
	panic("unimplemented")
}

// ListFlowDefinitions implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) ListFlowDefinitions(ctx context.Context, filter *database.ListOptions[domain.FlowDefinitionField]) (*database.ListResult[*domain.FlowDefinition], error) {
	panic("unimplemented")
}

// IsStatements implements [service.FlowDefinitionStatements].
// Subtle: this method shadows the method (statement).IsStatements of flowDefinitionStatements.statement.
func (f flowDefinitionStatements) IsStatements() {
	panic("unimplemented")
}

func newFlowDefinitionStatements(client queryExecutor) flowDefinitionStatements {
	return flowDefinitionStatements{
		statement: statement{
			client: client,
		},
	}
}

var _ service.FlowDefinitionStatements = (*flowDefinitionStatements)(nil)
