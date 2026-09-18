package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/environment"
)

const (
	createEnvironmentStmt = `INSERT INTO zitadel_nextgen.environments (project_id, id, name, class, expires_at, origins)` +
		` VALUES ($1, $2, $3, $4, $5, $6) RETURNING created_at`
	renewEnvironmentStmt = `UPDATE zitadel_nextgen.environments SET expires_at = $3, origins = $4 WHERE project_id = $1 AND id = $2`
	environmentQuery     = `SELECT project_id, id, name, class, expires_at, origins, created_at, current_deployment_id FROM zitadel_nextgen.environments`
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
	origins, err := environment.MarshalOrigins(entity.Origins)
	if err != nil {
		return err
	}
	return withTransaction(ctx, es.client, func(ctx context.Context, tx queryExecutor) error {
		if err := tx.QueryRow(ctx, createEnvironmentStmt,
			entity.ProjectID, entity.ID, entity.Name, entity.Class.String(), entity.ExpiresAt, nullJSONBytes(origins)).
			Scan(&entity.CreatedAt); err != nil {
			return wrapError(err)
		}
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindEnvironment, entity.ProjectID, entity.ID))
	})
}

// RenewEnvironment implements [service.EnvironmentStatements].
func (es environmentStatements) RenewEnvironment(ctx context.Context, entity *domain.Environment) error {
	origins, err := environment.MarshalOrigins(entity.Origins)
	if err != nil {
		return err
	}
	tag, err := es.client.Exec(ctx, renewEnvironmentStmt, entity.ProjectID, entity.ID, entity.ExpiresAt, nullJSONBytes(origins))
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return new(database.NoRowFoundError)
	}
	return nil
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
	entity, err := pgx.CollectExactlyOneRow(rows, es.scanEnvironment)
	if err != nil {
		return nil, wrapError(err)
	}
	return entity, nil
}

// ListEnvironments implements [service.EnvironmentStatements].
func (es environmentStatements) ListEnvironments(ctx context.Context, filter *database.ListOptions[domain.EnvironmentField]) (*database.ListResult[*domain.Environment], error) {
	var compiler statementCompiler
	if err := compileList(ctx, &compiler, environmentQuery, filter, environment.Schema, "zitadel_nextgen.environments", "id"); err != nil {
		return nil, err
	}

	rows, err := es.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}

	items, err := pgx.CollectRows(rows, es.scanEnvironment)
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

func (es environmentStatements) scanEnvironment(row pgx.CollectableRow) (*domain.Environment, error) {
	var (
		entity  domain.Environment
		class   string
		origins []byte
	)
	if err := row.Scan(&entity.ProjectID, &entity.ID, &entity.Name, &class, &entity.ExpiresAt, &origins, &entity.CreatedAt, &entity.CurrentDeploymentID); err != nil {
		return nil, err
	}
	parsedClass, err := domain.EnvironmentClassString(class)
	if err != nil {
		return nil, err
	}
	entity.Class = parsedClass
	parsedOrigins, err := environment.UnmarshalOrigins(origins)
	if err != nil {
		return nil, err
	}
	entity.Origins = parsedOrigins
	return &entity, nil
}

// nullJSONBytes stores an absent JSON document as NULL rather than an empty
// (and invalid) jsonb literal.
func nullJSONBytes(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return b
}

var _ service.EnvironmentStatements = (*environmentStatements)(nil)
