package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/policystore"
)

const (
	createPolicyStmt = `INSERT INTO policies ` +
		`(project_id, id, operation, created_at) VALUES (?, ?, ?, ?)`

	// Also the whole of a revise, where the foreign key on
	// (project_id, policy_id) reports an unknown policy.
	createPolicyRevisionStmt = `INSERT INTO policy_revisions ` +
		`(project_id, id, policy_id, config, created_at) VALUES (?, ?, ?, ?, ?)`

	// No FOR UPDATE: the dialect begins every transaction with BEGIN
	// IMMEDIATE on a single connection, so the write lock is already held and
	// a second publish waits for the first to commit. The select only reports
	// an unknown policy.
	lockPolicyStmt = `SELECT id FROM policies WHERE project_id = ? AND id = ?`

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
	// One stamp for both rows, so a policy nobody revised reports
	// CreatedAt == UpdatedAt.
	now := nowUnixNano()
	return withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Exec(ctx, createPolicyStmt,
			entity.ProjectID,
			entity.ID,
			entity.Operation,
			now,
		); err != nil {
			return wrapError(err)
		}
		if _, err := tx.Exec(ctx, createPolicyRevisionStmt,
			entity.ProjectID,
			entity.RevisionID,
			entity.ID,
			string(entity.Config),
			now,
		); err != nil {
			return wrapError(err)
		}
		entity.CreatedAt, entity.UpdatedAt = timeFromUnixNano(now), timeFromUnixNano(now)
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
	// Stamped at the insert, inside a transaction BEGIN IMMEDIATE already
	// serialized, so revision order follows transaction order.
	now := nowUnixNano()
	if _, err := s.client.Exec(ctx, createPolicyRevisionStmt,
		entity.ProjectID,
		revisionID,
		entity.ID,
		string(entity.Config),
		now,
	); err != nil {
		return policystore.ReviseNotFound(wrapError(err))
	}
	entity.RevisionID = revisionID
	entity.UpdatedAt = timeFromUnixNano(now)
	return nil
}

// LockPolicy implements [service.PolicyStatements].
func (s policyStatements) LockPolicy(ctx context.Context, projectID, id string) error {
	var locked string
	return wrapError(s.client.QueryRow(ctx, lockPolicyStmt, projectID, id).Scan(&locked))
}

// GetPolicy implements [service.PolicyStatements].
func (s policyStatements) GetPolicy(ctx context.Context, projectID, operation string) (*domain.Policy, error) {
	return s.getOne(ctx, policystore.ByOperation(projectID, operation), newestPolicyRevision)
}

// GetPolicyRevision implements [service.PolicyStatements].
func (s policyStatements) GetPolicyRevision(ctx context.Context, projectID, revisionID string) (*domain.Policy, error) {
	// No newest-revision conjunct: a pinned read must reach a superseded row.
	return s.getOne(ctx, policystore.ByRevision(projectID, revisionID))
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
	defer rows.Close()
	entity, err := collectExactlyOneRow(rows, scanPolicy)
	if err != nil {
		return nil, wrapError(err)
	}
	return entity, nil
}

func scanPolicy(rows *sql.Rows) (*domain.Policy, error) {
	var (
		entity                   domain.Policy
		config                   string
		createdNano, updatedNano int64
	)
	if err := rows.Scan(
		&entity.ProjectID,
		&entity.ID,
		&entity.Operation,
		&entity.RevisionID,
		&config,
		&createdNano,
		&updatedNano,
	); err != nil {
		return nil, err
	}
	entity.Config = []byte(config)
	entity.CreatedAt, entity.UpdatedAt = timeFromUnixNano(createdNano), timeFromUnixNano(updatedNano)
	return &entity, nil
}

var _ service.PolicyStatements = (*policyStatements)(nil)
