package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/policy"
)

const (
	createPolicyStmt = `INSERT INTO zitadel_nextgen.policies (project_id, id, operation, definition) VALUES ($1, $2, $3, $4) RETURNING created_at`
	policyQuery      = `SELECT project_id, id, operation, created_at, definition FROM zitadel_nextgen.policies`
)

type policyStatements struct{ statement }

func newPolicyStatements(client queryExecutor) policyStatements {
	return policyStatements{statement: statement{client: client}}
}

// CreatePolicy implements [service.PolicyStatements].
func (p policyStatements) CreatePolicy(ctx context.Context, entity *domain.Policy) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixPolicy); err != nil {
		return err
	}
	definition, err := policy.Marshal(entity)
	if err != nil {
		return err
	}
	return withTransaction(ctx, p.client, func(ctx context.Context, tx queryExecutor) error {
		if err := tx.QueryRow(ctx, createPolicyStmt, entity.ProjectID, entity.ID, entity.Operation, definition).
			Scan(&entity.CreatedAt); err != nil {
			return wrapError(err)
		}
		entity.CreatedAt = entity.CreatedAt.UTC()
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindPolicy, entity.ProjectID, entity.ID))
	})
}

// GetPolicyByID implements [service.PolicyStatements].
func (p policyStatements) GetPolicyByID(ctx context.Context, projectID, id string) (*domain.Policy, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, policyQuery, &database.ListOptions[domain.PolicyField]{
		Filter: database.And(
			database.Equal(database.Col(domain.PolicyFieldProjectID), projectID),
			database.Equal(database.Col(domain.PolicyFieldID), id),
		),
	}, policy.Schema); err != nil {
		return nil, err
	}
	rows, err := p.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	entity, err := pgx.CollectExactlyOneRow(rows, p.scanPolicy)
	if err != nil {
		return nil, wrapError(err)
	}
	return entity, nil
}

// ListPolicies implements [service.PolicyStatements].
func (p policyStatements) ListPolicies(ctx context.Context, filter *database.ListOptions[domain.PolicyField]) (*database.ListResult[*domain.Policy], error) {
	var compiler statementCompiler
	if err := compileList(ctx, &compiler, policyQuery, filter, policy.Schema, "zitadel_nextgen.policies", "id"); err != nil {
		return nil, err
	}
	rows, err := p.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	items, err := pgx.CollectRows(rows, p.scanPolicy)
	if err != nil {
		return nil, wrapError(err)
	}
	nextCursor := pagination.MarshalNext(filter.Pagination.OrderBy, items, policy.Schema, filter.Pagination.Limit)
	return &database.ListResult[*domain.Policy]{Items: items, NextCursor: nextCursor}, nil
}

func (p policyStatements) scanPolicy(row pgx.CollectableRow) (*domain.Policy, error) {
	var (
		projectID  string
		id         string
		operation  string
		createdAt  time.Time
		definition []byte
	)
	if err := row.Scan(&projectID, &id, &operation, &createdAt, &definition); err != nil {
		return nil, err
	}
	return policy.ToDomain(projectID, id, operation, createdAt, definition)
}

var _ service.PolicyStatements = (*policyStatements)(nil)
