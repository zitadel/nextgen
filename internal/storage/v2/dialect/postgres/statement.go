package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
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

func (s statements) UpdateProject(ctx context.Context, entity *domain.Project) error {
	//TODO implement me
	panic("implement me")
}

func (s statements) Statements() service.AllStatements {
	return s
}

// IsStatements implements [service.Statements].
func (s statements) IsStatements() {}

func newStatements(client queryExecutor) statements {
	return statements{
		projectStatements:        newProjectStatements(client),
		flowDefinitionStatements: newFlowDefinitionStatements(client),
	}
}

var _ service.Statements = (*statements)(nil)

type statement struct {
	client queryExecutor
}

// IsStatements implements [service.Statements].
func (s *statement) IsStatements() {}

var _ service.Statements = (*statement)(nil)
