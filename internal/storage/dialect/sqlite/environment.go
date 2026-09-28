package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/environment"
)

const (
	createEnvironmentStmt = `INSERT INTO environments (project_id, id, name, created_at) VALUES (?, ?, ?, ?) RETURNING created_at`
	environmentQuery      = `SELECT project_id, id, name, created_at FROM environments`
)

type environmentStatements struct{ statement }

func newEnvironmentStatements(client queryExecutor) environmentStatements {
	return environmentStatements{statement: statement{client: client}}
}

// CreateEnvironment implements [service.EnvironmentStatements].
func (es environmentStatements) CreateEnvironment(ctx context.Context, entity *domain.Environment) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixEnvironment); err != nil {
		return err
	}
	now := nowUnixNano()
	return withTransaction(ctx, es.client, func(ctx context.Context, tx queryExecutor) error {
		var createdNano int64
		if err := tx.QueryRow(ctx, createEnvironmentStmt, entity.ProjectID, entity.ID, entity.Name, now).
			Scan(&createdNano); err != nil {
			return wrapError(err)
		}
		entity.CreatedAt = timeFromUnixNano(createdNano)
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindEnvironment, entity.ProjectID, entity.ID))
	})
}

// GetEnvironmentByName implements [service.EnvironmentStatements].
func (es environmentStatements) GetEnvironmentByName(ctx context.Context, projectID, name string) (*domain.Environment, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, environmentQuery, &database.ListOptions[domain.EnvironmentField]{
		Filter: database.And(
			database.Equal(database.Col(domain.EnvironmentFieldProjectID), projectID),
			database.Equal(database.Col(domain.EnvironmentFieldName), name),
		),
	}, environment.Schema); err != nil {
		return nil, err
	}
	rows, err := es.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	item, err := collectExactlyOneRow(rows, scanEnvironment)
	if err != nil {
		return nil, wrapError(err)
	}
	return item, nil
}

// ListEnvironments implements [service.EnvironmentStatements].
func (es environmentStatements) ListEnvironments(ctx context.Context, filter *database.ListOptions[domain.EnvironmentField]) (*database.ListResult[*domain.Environment], error) {
	var compiler statementCompiler
	if err := compileList(ctx, &compiler, environmentQuery, filter, environment.Schema, "environments", "id"); err != nil {
		return nil, err
	}
	rows, err := es.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	items, err := collectRows(rows, scanEnvironment)
	if err != nil {
		return nil, wrapError(err)
	}
	nextCursor := pagination.MarshalNext(
		filter.Pagination.OrderBy,
		items,
		environment.Schema,
		filter.Pagination.Limit,
	)
	return &database.ListResult[*domain.Environment]{Items: items, NextCursor: nextCursor}, nil
}

func scanEnvironment(rows *sql.Rows) (*domain.Environment, error) {
	var (
		entity      domain.Environment
		createdNano int64
	)
	if err := rows.Scan(&entity.ProjectID, &entity.ID, &entity.Name, &createdNano); err != nil {
		return nil, err
	}
	entity.CreatedAt = timeFromUnixNano(createdNano)
	return &entity, nil
}

var _ service.EnvironmentStatements = (*environmentStatements)(nil)
