package spanner

import (
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type queryExecutor interface {
}

type statements struct {
	client queryExecutor
}

// Project implements [database.Statementer].
func (s statements) Project() database.ProjectStatements {
	return s
}

// FlowDefinition implements [database.Statementer].
func (s statements) FlowDefinition() database.FlowDefinitionStatements {
	return s
}

var (
	_ database.Statementer = (*statements)(nil)
)
