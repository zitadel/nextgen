package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type queryExecutor interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type statements struct {
	client queryExecutor
}

// FlowDefinition implements [database.Statementer].
func (s statements) FlowDefinition() database.FlowDefinitionStatements {
	return s
}

// Project implements [database.Statementer].
func (s statements) Project() database.ProjectStatements {
	return s
}

var _ database.Statementer = (*statements)(nil)
