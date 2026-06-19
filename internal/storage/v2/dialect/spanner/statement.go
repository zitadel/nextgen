package spanner

import "github.com/zitadel/nextgen/internal/service"

type queryExecutor interface {
}

type statements struct {
	projectStatements
	flowDefinitionStatements
}

var _ service.Statements = (*statements)(nil)

func newStatements(client queryExecutor) statements {
	return statements{
		projectStatements:        newProjectStatements(client),
		flowDefinitionStatements: newFlowDefinitionStatements(client),
	}
}

type statement struct {
	client queryExecutor
}
