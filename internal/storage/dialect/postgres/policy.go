package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/policystore"
)

const (
	createPolicyStmt = `INSERT INTO zitadel_nextgen.policies ` +
		`(project_id, id, operation) VALUES ($1, $2, $3) RETURNING created_at`

	// The first revision takes the column default now(), the policy row's
	// transaction timestamp, so a policy nobody revised has CreatedAt ==
	// UpdatedAt.
	createPolicyRevisionStmt = `INSERT INTO zitadel_nextgen.policy_revisions ` +
		`(project_id, id, policy_id, config) VALUES ($1, $2, $3, $4) RETURNING created_at`

	// clock_timestamp() rather than now(): a revise that began before a
	// concurrent one but took the policy lock after it would otherwise stamp a
	// time older than the revision it follows (ADR 063 section 7).
	revisePolicyStmt = `INSERT INTO zitadel_nextgen.policy_revisions ` +
		`(project_id, id, policy_id, config, created_at) VALUES ($1, $2, $3, $4, clock_timestamp()) RETURNING created_at`

	// FOR UPDATE holds the policy row until the transaction ends, so a second
	// publish of the same operation waits and then follows the first.
	lockPolicyStmt = `SELECT id FROM zitadel_nextgen.policies` +
		` WHERE project_id = $1 AND id = $2 FOR UPDATE`

	policyQuery = `SELECT p.project_id, p.id, p.operation, r.id, r.config, p.created_at, r.created_at
FROM zitadel_nextgen.policies p
JOIN zitadel_nextgen.policy_revisions r
  ON r.project_id = p.project_id AND r.policy_id = p.id`

	// A row is the newest revision when no sibling of the same policy has a
	// greater created_at; the unique index on (project_id, policy_id,
	// created_at) makes that a total order.
	newestPolicyRevision = `NOT EXISTS (SELECT 1 FROM zitadel_nextgen.policy_revisions newer` +
		` WHERE newer.project_id = r.project_id` +
		` AND newer.policy_id = r.policy_id` +
		` AND newer.created_at > r.created_at)`
)

type policyStatements struct{ statement }

func newPolicyStatements(client queryExecutor) policyStatements {
	return policyStatements{statement: statement{client: client}}
}

// CreatePolicy implements [service.PolicyStatements].
func (s policyStatements) CreatePolicy(ctx context.Context, entity *domain.Policy) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixPolicy); err != nil {
		return err
	}
	if err := ensureManagedID(&entity.RevisionID, domain.PrefixPolicyRevision); err != nil {
		return err
	}
	return withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		if err := tx.QueryRow(ctx, createPolicyStmt,
			entity.ProjectID,
			entity.ID,
			entity.Operation,
		).Scan(&entity.CreatedAt); err != nil {
			return wrapError(err)
		}
		if err := tx.QueryRow(ctx, createPolicyRevisionStmt,
			entity.ProjectID,
			entity.RevisionID,
			entity.ID,
			entity.Config,
		).Scan(&entity.UpdatedAt); err != nil {
			return wrapError(err)
		}
		// pgx scans timestamptz in Local; reads normalize to UTC.
		entity.CreatedAt, entity.UpdatedAt = entity.CreatedAt.UTC(), entity.UpdatedAt.UTC()
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindPolicy, entity.ProjectID, entity.ID))
	})
}

// RevisePolicy implements [service.PolicyStatements].
func (s policyStatements) RevisePolicy(ctx context.Context, entity *domain.Policy) error {
	// A new id every time, not ensureManagedID: the entity usually arrives
	// from a get, and keeping its revision id would rewrite that revision.
	revisionID, err := managedIDs.New(string(domain.PrefixPolicyRevision))
	if err != nil {
		return err
	}
	if err := s.client.QueryRow(ctx, revisePolicyStmt,
		entity.ProjectID,
		revisionID,
		entity.ID,
		entity.Config,
	).Scan(&entity.UpdatedAt); err != nil {
		return policystore.ReviseNotFound(wrapError(err))
	}
	entity.UpdatedAt = entity.UpdatedAt.UTC()
	entity.RevisionID = revisionID
	return nil
}

// LockPolicy implements [service.PolicyStatements].
func (s policyStatements) LockPolicy(ctx context.Context, projectID, id string) error {
	var locked string
	return wrapError(s.client.QueryRow(ctx, lockPolicyStmt, projectID, id).Scan(&locked))
}

// GetPolicy implements [service.PolicyStatements].
func (s policyStatements) GetPolicy(ctx context.Context, filter database.Filter[domain.PolicyField]) (*domain.Policy, error) {
	return s.getOne(ctx, filter, newestPolicyRevision)
}

// GetPolicyRevision implements [service.PolicyStatements].
func (s policyStatements) GetPolicyRevision(ctx context.Context, projectID, revisionID string) (*domain.Policy, error) {
	// No newest-revision conjunct: a pinned read must reach a superseded row.
	return s.getOne(ctx, policystore.ByRevision(projectID, revisionID))
}

// ListPolicies implements [service.PolicyStatements].
func (s policyStatements) ListPolicies(ctx context.Context, opts *database.ListOptions[domain.PolicyField]) (*database.ListResult[*domain.Policy], error) {
	opts, err := policystore.WithDefaultOrder(opts)
	if err != nil {
		return nil, err
	}
	return s.list(ctx, opts, newestPolicyRevision)
}

// ListPolicyRevisions implements [service.PolicyStatements].
func (s policyStatements) ListPolicyRevisions(ctx context.Context, projectID, policyID string, page database.Page[domain.PolicyField]) (*database.ListResult[*domain.Policy], error) {
	// No newest-revision conjunct: the history includes superseded rows.
	return s.list(ctx, policystore.RevisionListOptions(projectID, policyID, page))
}

// list runs the management-list path: the authz predicate filters on the
// policy row, so a revision is visible exactly when its policy is.
func (s policyStatements) list(ctx context.Context, opts *database.ListOptions[domain.PolicyField], conjuncts ...string) (*database.ListResult[*domain.Policy], error) {
	items, nextCursor, err := pagination.Page(opts.Pagination, policystore.Schema, func(limit uint32) ([]*domain.Policy, error) {
		opts := opts.WithLimit(limit)
		var compiler statementCompiler
		if err := compileList(ctx, &compiler, policyQuery, opts, policystore.Schema, "p", "id", conjuncts...); err != nil {
			return nil, err
		}
		rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
		if err != nil {
			return nil, wrapError(err)
		}
		items, err := pgx.CollectRows(rows, scanPolicy)
		if err != nil {
			return nil, wrapError(err)
		}
		return items, nil
	})
	if err != nil {
		return nil, err
	}
	return &database.ListResult[*domain.Policy]{Items: items, NextCursor: nextCursor}, nil
}

func (s policyStatements) getOne(ctx context.Context, filter database.Filter[domain.PolicyField], conjuncts ...string) (*domain.Policy, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, policyQuery, &database.ListOptions[domain.PolicyField]{
		Filter: filter,
	}, policystore.Schema, conjuncts...); err != nil {
		return nil, err
	}
	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	entity, err := pgx.CollectExactlyOneRow(rows, scanPolicy)
	if err != nil {
		return nil, wrapError(err)
	}
	return entity, nil
}

func scanPolicy(row pgx.CollectableRow) (*domain.Policy, error) {
	var (
		entity               domain.Policy
		config               []byte
		createdAt, updatedAt time.Time
	)
	if err := row.Scan(
		&entity.ProjectID,
		&entity.ID,
		&entity.Operation,
		&entity.RevisionID,
		&config,
		&createdAt,
		&updatedAt,
	); err != nil {
		return nil, err
	}
	entity.Config = config
	entity.CreatedAt, entity.UpdatedAt = createdAt.UTC(), updatedAt.UTC()
	return &entity, nil
}

var _ service.PolicyStatements = (*policyStatements)(nil)
