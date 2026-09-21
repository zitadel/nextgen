package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/policy"
)

const (
	createPolicyStmt = `INSERT INTO policies (project_id, id, operation, definition, created_at) VALUES (?, ?, ?, ?, ?) RETURNING created_at`
	policyQuery      = `SELECT project_id, id, operation, created_at, definition FROM policies`
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
	raw, err := policy.Marshal(entity)
	if err != nil {
		return err
	}
	now := nowUnixNano()
	return withTransaction(ctx, p.client, func(ctx context.Context, tx queryExecutor) error {
		var createdNano int64
		if err := tx.QueryRow(ctx, createPolicyStmt, entity.ProjectID, entity.ID, entity.Operation, string(raw), now).Scan(&createdNano); err != nil {
			return wrapError(err)
		}
		entity.CreatedAt = timeFromUnixNano(createdNano)
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
	defer rows.Close()
	item, err := collectExactlyOneRow(rows, scanPolicy)
	if err != nil {
		return nil, wrapError(err)
	}
	return item, nil
}

// ListPolicies implements [service.PolicyStatements].
func (p policyStatements) ListPolicies(ctx context.Context, filter *database.ListOptions[domain.PolicyField]) (*database.ListResult[*domain.Policy], error) {
	var compiler statementCompiler
	if err := compileList(ctx, &compiler, policyQuery, filter, policy.Schema, "policies", "id"); err != nil {
		return nil, err
	}
	rows, err := p.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	items, err := collectRows(rows, scanPolicy)
	if err != nil {
		return nil, wrapError(err)
	}
	nextCursor := pagination.MarshalNext(filter.Pagination.OrderBy, items, policy.Schema, filter.Pagination.Limit)
	return &database.ListResult[*domain.Policy]{Items: items, NextCursor: nextCursor}, nil
}

func scanPolicy(rows *sql.Rows) (*domain.Policy, error) {
	var (
		projectID   string
		id          string
		operation   string
		createdNano int64
		definition  sql.NullString
	)
	if err := rows.Scan(&projectID, &id, &operation, &createdNano, &definition); err != nil {
		return nil, err
	}
	var raw []byte
	if definition.Valid && definition.String != "" {
		raw = []byte(definition.String)
	}
	return policy.ToDomain(projectID, id, operation, timeFromUnixNano(createdNano), raw)
}

var _ service.PolicyStatements = (*policyStatements)(nil)
