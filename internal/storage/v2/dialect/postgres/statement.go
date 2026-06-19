package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type queryExecutor interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

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

type statement struct {
	client queryExecutor
}
