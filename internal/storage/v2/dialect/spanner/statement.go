package spanner

import (
	"github.com/zitadel/nextgen/internal/service"
)

type statements struct {
	projectStatements
	flowDefinitionStatements
}

func (s statements) Statements() service.AllStatements {
	return s
}

// IsStatements implements [service.Statements].
func (s statements) IsStatements() {}

func newStatements(db spannerDB) statements {
	return statements{
		projectStatements:        newProjectStatements(db),
		flowDefinitionStatements: newFlowDefinitionStatements(db),
	}
}

var _ service.AllStatements = (*statements)(nil)

type statement struct {
	db spannerDB
}

// IsStatements implements [service.Statements].
func (s *statement) IsStatements() {}

var _ service.Statements = (*statement)(nil)
