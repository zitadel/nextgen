package spanner

import (
	"context"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/policystore"
)

const (
	createPolicyStmt = `INSERT INTO policies ` +
		`(project_id, id, operation) VALUES (@p1, @p2, @p3) THEN RETURN created_at`

	// The whole of a revise, where the foreign key on (project_id, policy_id)
	// reports an unknown policy. The default CURRENT_TIMESTAMP() is taken when
	// this statement runs, after the publish transaction locked the policy
	// row, so revision order follows lock order.
	createPolicyRevisionStmt = `INSERT INTO policy_revisions ` +
		`(project_id, id, policy_id, config) VALUES (@p1, @p2, @p3, @p4) THEN RETURN created_at`

	// Spanner evaluates CURRENT_TIMESTAMP() per statement, so the first
	// revision binds the policy's stamp; a default would land after it.
	createFirstPolicyRevisionStmt = `INSERT INTO policy_revisions ` +
		`(project_id, id, policy_id, config, created_at) VALUES (@p1, @p2, @p3, @p4, @p5)`

	lockPolicyStmt = `SELECT id FROM policies WHERE project_id = @p1 AND id = @p2 FOR UPDATE`

	policyQuery = `SELECT p.project_id, p.id, p.operation, r.id, r.config, p.created_at, r.created_at
FROM policies p
JOIN policy_revisions r
  ON r.project_id = p.project_id AND r.policy_id = p.id`

	// See the postgres dialect.
	newestPolicyRevision = `NOT EXISTS (SELECT 1 FROM policy_revisions AS newer` +
		` WHERE newer.project_id = r.project_id` +
		` AND newer.policy_id = r.policy_id` +
		` AND newer.created_at > r.created_at)`
)

type policyStatements struct{ statement }

func newPolicyStatements(db queryExecutor) policyStatements {
	return policyStatements{statement: statement{db: db}}
}

// CreatePolicy implements [service.PolicyStatements].
func (s policyStatements) CreatePolicy(ctx context.Context, entity *domain.Policy) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixPolicy); err != nil {
		return err
	}
	if err := ensureManagedID(&entity.RevisionID, domain.PrefixPolicyRevision); err != nil {
		return err
	}
	config, err := encodeNullJSON(entity.Config)
	if err != nil {
		return wrapError(err)
	}
	return withTransaction(ctx, s.db, func(ctx context.Context, tx queryExecutor) error {
		stmt := buildStatement(createPolicyStmt,
			entity.ProjectID,
			entity.ID,
			entity.Operation,
		).statement()
		// A retry replays this callback, so the stamp stays local.
		var createdAt time.Time
		if err := tx.Write(ctx, stmt, scanReturnedTimestamp(&createdAt)); err != nil {
			return err
		}
		revision := buildStatement(createFirstPolicyRevisionStmt,
			entity.ProjectID,
			entity.RevisionID,
			entity.ID,
			config,
			createdAt,
		).statement()
		if _, err := tx.Update(ctx, revision); err != nil {
			return err
		}
		entity.CreatedAt, entity.UpdatedAt = createdAt, createdAt
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindPolicy, entity.ProjectID, entity.ID))
	})
}

// RevisePolicy implements [service.PolicyStatements].
func (s policyStatements) RevisePolicy(ctx context.Context, entity *domain.Policy) error {
	// A new id every time; see the postgres dialect.
	revisionID, err := managedIDs.New(string(domain.PrefixPolicyRevision))
	if err != nil {
		return err
	}
	config, err := encodeNullJSON(entity.Config)
	if err != nil {
		return wrapError(err)
	}
	revision := buildStatement(createPolicyRevisionStmt,
		entity.ProjectID,
		revisionID,
		entity.ID,
		config,
	).statement()
	if err := s.db.Write(ctx, revision, scanReturnedTimestamp(&entity.UpdatedAt)); err != nil {
		return policystore.ReviseNotFound(err)
	}
	entity.RevisionID = revisionID
	return nil
}

// LockPolicy implements [service.PolicyStatements]. See LockIDPConnection for
// why FOR UPDATE.
func (s policyStatements) LockPolicy(ctx context.Context, projectID, id string) error {
	return s.db.Query(ctx, buildStatement(lockPolicyStmt, projectID, id).statement(), func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(*spanner.Row) (struct{}, error) { return struct{}{}, nil })
		return err
	})
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
		var items []*domain.Policy
		if err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
			var err error
			items, err = collectRows(iter, scanPolicy)
			return err
		}); err != nil {
			return nil, err
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
	var entity *domain.Policy
	if err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		entity, err = collectOneRow(iter, scanPolicy)
		return err
	}); err != nil {
		return nil, err
	}
	return entity, nil
}

func scanPolicy(row *spanner.Row) (*domain.Policy, error) {
	var (
		entity               domain.Policy
		configJSON           spanner.NullJSON
		createdAt, updatedAt time.Time
	)
	if err := row.Columns(
		&entity.ProjectID,
		&entity.ID,
		&entity.Operation,
		&entity.RevisionID,
		&configJSON,
		&createdAt,
		&updatedAt,
	); err != nil {
		return nil, err
	}
	config, err := decodeNullJSON(configJSON)
	if err != nil {
		return nil, wrapError(err)
	}
	entity.Config = config
	entity.CreatedAt, entity.UpdatedAt = createdAt.UTC(), updatedAt.UTC()
	return &entity, nil
}

var _ service.PolicyStatements = (*policyStatements)(nil)
