package spanner

import "github.com/zitadel/nextgen/internal/service"

type queryExecutor interface {}

type statements struct {
	projectStatements
	flowDefinitionStatements
}

func newStatements(client queryExecutor) statements {
	return statements{
		projectStatements:        newProjectStatements(client),
		flowDefinitionStatements: newFlowDefinitionStatements(client),
	}
}

func (s statements) Statements() service.AllStatements {
	return s
}

// IsStatements implements [service.Statements].
func (s statements) IsStatements() {}

var _ service.AllStatements = (*statements)(nil)

type statement struct {
	client queryExecutor
}

// IsStatements implements [service.Statements].
func (s *statement) IsStatements() {}

var _ service.Statements = (*statement)(nil)
