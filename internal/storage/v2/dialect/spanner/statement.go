package spanner

import (
	"github.com/zitadel/nextgen/internal/service"
)

type statements struct {
	projectStatements
	flowDefinitionStatements
	cryptoKeyStatements
	userStatements
	userPasswordStatements
}

func (s statements) Statements() service.AllStatements {
	return s
}

// IsStatements implements [service.Statements].
func (s statements) IsStatements() {}

func newStatements(db queryExecutor) statements {
	return statements{
		projectStatements:        newProjectStatements(db),
		flowDefinitionStatements: newFlowDefinitionStatements(db),
		cryptoKeyStatements:      newCryptoKeyStatements(db),
		userStatements:           newUserStatements(db),
		userPasswordStatements:   newUserPasswordStatements(db),
	}
}

var _ service.AllStatements = (*statements)(nil)

type statement struct {
	db queryExecutor
}

// IsStatements implements [service.Statements].
func (s *statement) IsStatements() {}

var _ service.Statements = (*statement)(nil)
