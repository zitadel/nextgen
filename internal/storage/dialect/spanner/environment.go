package spanner

import (
	"context"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/environment"
)

const (
	createEnvironmentStmt = `INSERT INTO environments (project_id, id, name) VALUES (@p1, @p2, @p3) THEN RETURN created_at`
	environmentQuery      = `SELECT project_id, id, name, created_at FROM environments`
)

type environmentStatements struct{ statement }

func newEnvironmentStatements(db queryExecutor) environmentStatements {
	return environmentStatements{
		statement: statement{
			db: db,
		},
	}
}

// CreateEnvironment implements [service.EnvironmentStatements].
func (es environmentStatements) CreateEnvironment(ctx context.Context, entity *domain.Environment) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixEnvironment); err != nil {
		return err
	}
	return withTransaction(ctx, es.db, func(ctx context.Context, tx queryExecutor) error {
		stmt := buildStatement(createEnvironmentStmt, entity.ProjectID, entity.ID, entity.Name).statement()
		if err := tx.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
			_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
				if err := row.Columns(&entity.CreatedAt); err != nil {
					return struct{}{}, err
				}
				entity.CreatedAt = entity.CreatedAt.UTC()
				return struct{}{}, nil
			})
			return err
		}); err != nil {
			return err
		}
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindEnvironment, entity.ProjectID, entity.ID))
	})
}

// GetEnvironmentByName implements [service.EnvironmentStatements].
//
// Unlike the other single-row spanner reads this cannot use ReadRow: name is
// the project-unique handle, not part of the (project_id, id) primary key, so
// it goes through the compiler like a filtered list.
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

	var entity *domain.Environment
	if err := es.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		entity, err = collectOneRow(iter, es.scanEnvironment)
		return err
	}); err != nil {
		return nil, err
	}
	return entity, nil
}

// ListEnvironments implements [service.EnvironmentStatements].
func (es environmentStatements) ListEnvironments(ctx context.Context, filter *database.ListOptions[domain.EnvironmentField]) (*database.ListResult[*domain.Environment], error) {
	var compiler statementCompiler
	if err := compileList(ctx, &compiler, environmentQuery, filter, environment.Schema, "environments", "id"); err != nil {
		return nil, err
	}

	var items []*domain.Environment
	if err := es.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, es.scanEnvironment)
		return err
	}); err != nil {
		return nil, err
	}

	nextCursor := pagination.MarshalNext(
		filter.Pagination.OrderBy,
		items,
		environment.Schema,
		filter.Pagination.Limit,
	)

	return &database.ListResult[*domain.Environment]{Items: items, NextCursor: nextCursor}, nil
}

func (es environmentStatements) scanEnvironment(row *spanner.Row) (*domain.Environment, error) {
	var (
		projectID string
		id        string
		name      string
		createdAt time.Time
	)
	if err := row.Columns(&projectID, &id, &name, &createdAt); err != nil {
		return nil, err
	}
	return &domain.Environment{
		ProjectID: projectID,
		ID:        id,
		Name:      name,
		CreatedAt: createdAt.UTC(),
	}, nil
}

var _ service.EnvironmentStatements = (*environmentStatements)(nil)
