package spanner

import (
	"context"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/policy"
)

const (
	policiesTable    = "policies"
	createPolicyStmt = `INSERT INTO policies (project_id, id, operation, definition) VALUES (@p1, @p2, @p3, @p4) THEN RETURN created_at`
	policyQuery      = `SELECT project_id, id, operation, created_at, definition FROM policies`
)

var policyColumns = []string{"project_id", "id", "operation", "created_at", "definition"}

type policyStatements struct{ statement }

func newPolicyStatements(db queryExecutor) policyStatements {
	return policyStatements{statement: statement{db: db}}
}

// CreatePolicy implements [service.PolicyStatements].
func (p policyStatements) CreatePolicy(ctx context.Context, entity *domain.Policy) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixPolicy); err != nil {
		return err
	}
	raw, err := policy.Marshal(entity)
	if err != nil {
		return err
	}
	definition, err := encodeNullJSON(raw)
	if err != nil {
		return err
	}
	return withTransaction(ctx, p.db, func(ctx context.Context, tx queryExecutor) error {
		stmt := buildStatement(createPolicyStmt, entity.ProjectID, entity.ID, entity.Operation, definition).statement()
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
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindPolicy, entity.ProjectID, entity.ID))
	})
}

// GetPolicyByID implements [service.PolicyStatements].
func (p policyStatements) GetPolicyByID(ctx context.Context, projectID, id string) (*domain.Policy, error) {
	row, err := p.db.ReadRow(ctx, policiesTable, spanner.Key{projectID, id}, policyColumns)
	if err != nil {
		return nil, err
	}
	return p.scanPolicy(row)
}

// ListPolicies implements [service.PolicyStatements].
func (p policyStatements) ListPolicies(ctx context.Context, filter *database.ListOptions[domain.PolicyField]) (*database.ListResult[*domain.Policy], error) {
	var compiler statementCompiler
	if err := compileList(ctx, &compiler, policyQuery, filter, policy.Schema, "policies", "id"); err != nil {
		return nil, err
	}
	var items []*domain.Policy
	err := p.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, p.scanPolicy)
		return err
	})
	if err != nil {
		return nil, err
	}
	nextCursor := pagination.MarshalNext(filter.Pagination.OrderBy, items, policy.Schema, filter.Pagination.Limit)
	return &database.ListResult[*domain.Policy]{Items: items, NextCursor: nextCursor}, nil
}

func (p policyStatements) scanPolicy(row *spanner.Row) (*domain.Policy, error) {
	var (
		projectID      string
		id             string
		operation      string
		createdAt      time.Time
		definitionJSON spanner.NullJSON
	)
	if err := row.Columns(&projectID, &id, &operation, &createdAt, &definitionJSON); err != nil {
		return nil, err
	}
	raw, err := decodeNullJSON(definitionJSON)
	if err != nil {
		return nil, err
	}
	return policy.ToDomain(projectID, id, operation, createdAt, raw)
}

var _ service.PolicyStatements = (*policyStatements)(nil)
