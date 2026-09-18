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
	createEnvironmentStmt = `INSERT INTO environments (project_id, id, name, class, expires_at, origins)` +
		` VALUES (@p1, @p2, @p3, @p4, @p5, @p6) THEN RETURN created_at`
	renewEnvironmentStmt = `UPDATE environments SET expires_at = @p3, origins = @p4 WHERE project_id = @p1 AND id = @p2`
	environmentQuery     = `SELECT project_id, id, name, class, expires_at, origins, created_at, current_deployment_id FROM environments`
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
	rawOrigins, err := environment.MarshalOrigins(entity.Origins)
	if err != nil {
		return err
	}
	origins, err := encodeNullJSON(rawOrigins)
	if err != nil {
		return err
	}
	return withTransaction(ctx, es.db, func(ctx context.Context, tx queryExecutor) error {
		stmt := buildStatement(createEnvironmentStmt,
			entity.ProjectID, entity.ID, entity.Name, entity.Class.String(), spannerNullTimePtr(entity.ExpiresAt), origins).statement()
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

// RenewEnvironment implements [service.EnvironmentStatements].
func (es environmentStatements) RenewEnvironment(ctx context.Context, entity *domain.Environment) error {
	rawOrigins, err := environment.MarshalOrigins(entity.Origins)
	if err != nil {
		return err
	}
	origins, err := encodeNullJSON(rawOrigins)
	if err != nil {
		return err
	}
	return withTransaction(ctx, es.db, func(ctx context.Context, tx queryExecutor) error {
		stmt := buildStatement(renewEnvironmentStmt, entity.ProjectID, entity.ID, spannerNullTimePtr(entity.ExpiresAt), origins).statement()
		affected, err := tx.Update(ctx, stmt)
		if err != nil {
			return err
		}
		if affected == 0 {
			return new(database.NoRowFoundError)
		}
		return nil
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
		projectID         string
		id                string
		name              string
		class             string
		expiresAt         spanner.NullTime
		origins           spanner.NullJSON
		createdAt         time.Time
		currentDeployment spanner.NullString
	)
	if err := row.Columns(&projectID, &id, &name, &class, &expiresAt, &origins, &createdAt, &currentDeployment); err != nil {
		return nil, err
	}
	parsedClass, err := domain.EnvironmentClassString(class)
	if err != nil {
		return nil, err
	}
	rawOrigins, err := decodeNullJSON(origins)
	if err != nil {
		return nil, err
	}
	parsedOrigins, err := environment.UnmarshalOrigins(rawOrigins)
	if err != nil {
		return nil, err
	}
	entity := &domain.Environment{
		ProjectID:           projectID,
		ID:                  id,
		Name:                name,
		Class:               parsedClass,
		Origins:             parsedOrigins,
		CreatedAt:           createdAt.UTC(),
		CurrentDeploymentID: spannerNullStringPtr(currentDeployment),
	}
	if expiresAt.Valid {
		t := expiresAt.Time.UTC()
		entity.ExpiresAt = &t
	}
	return entity, nil
}

func spannerNullTimePtr(t *time.Time) spanner.NullTime {
	if t == nil {
		return spanner.NullTime{Valid: false}
	}
	return spanner.NullTime{Time: t.UTC(), Valid: true}
}

var _ service.EnvironmentStatements = (*environmentStatements)(nil)
