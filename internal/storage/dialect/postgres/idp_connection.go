package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/idpconnection"
)

const (
	createIDPConnectionStmt = `INSERT INTO zitadel_nextgen.idp_connections ` +
		`(project_id, id, slug) VALUES ($1, $2, $3) RETURNING created_at`

	// The revision's created_at is served as UpdatedAt, so the insert returns
	// it. This is also the whole of a revise, where the foreign key on
	// (project_id, connection_id) reports an unknown connection.
	createIDPConnectionRevisionStmt = `INSERT INTO zitadel_nextgen.idp_connection_revisions ` +
		`(project_id, id, connection_id, document) VALUES ($1, $2, $3, $4) RETURNING created_at`

	// One row per revision, carrying its connection's identity. The last column
	// is the revision's created_at, which reads serve as UpdatedAt.
	idpConnectionQuery = `SELECT c.project_id, c.id, c.slug, r.id, r.document, c.created_at, r.created_at
FROM zitadel_nextgen.idp_connections c
JOIN zitadel_nextgen.idp_connection_revisions r
  ON r.project_id = c.project_id AND r.connection_id = c.id`

	// Nothing stores which revision is newest (ADR 063 §7), so a row is newest
	// when no sibling of the same connection has a greater created_at. The
	// unique index on (project_id, connection_id, created_at) makes that a
	// total order, so no tiebreak is needed here.
	newestIDPRevision = `NOT EXISTS (SELECT 1 FROM zitadel_nextgen.idp_connection_revisions newer` +
		` WHERE newer.project_id = r.project_id` +
		` AND newer.connection_id = r.connection_id` +
		` AND newer.created_at > r.created_at)`
)

type idpConnectionStatements struct{ statement }

func newIDPConnectionStatements(client queryExecutor) idpConnectionStatements {
	return idpConnectionStatements{statement: statement{client: client}}
}

// CreateIDPConnection implements [service.IDPConnectionStatements].
func (s idpConnectionStatements) CreateIDPConnection(ctx context.Context, entity *domain.IDPConnection) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixIDPConnection); err != nil {
		return err
	}
	if err := ensureManagedID(&entity.RevisionID, domain.PrefixIDPConnectionRevision); err != nil {
		return err
	}
	return withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		if err := tx.QueryRow(ctx, createIDPConnectionStmt,
			entity.ProjectID,
			entity.ID,
			entity.Slug,
		).Scan(&entity.CreatedAt); err != nil {
			return wrapError(err)
		}
		// now() is frozen for the transaction, so both rows get one stamp and a
		// connection nobody revised reports CreatedAt == UpdatedAt.
		if err := tx.QueryRow(ctx, createIDPConnectionRevisionStmt,
			entity.ProjectID,
			entity.RevisionID,
			entity.ID,
			entity.Document,
		).Scan(&entity.UpdatedAt); err != nil {
			return wrapError(err)
		}
		// pgx scans timestamptz in Local; reads normalize to UTC.
		entity.CreatedAt, entity.UpdatedAt = entity.CreatedAt.UTC(), entity.UpdatedAt.UTC()
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindIDPConnection, entity.ProjectID, entity.ID))
	})
}

// ReviseIDPConnection implements [service.IDPConnectionStatements].
func (s idpConnectionStatements) ReviseIDPConnection(ctx context.Context, entity *domain.IDPConnection) error {
	// A new id every time, not ensureManagedID: the entity usually arrives from
	// a get, and keeping its revision id would rewrite that revision.
	revisionID, err := managedIDs.New(string(domain.PrefixIDPConnectionRevision))
	if err != nil {
		return err
	}
	// One insert, so no transaction. The connection row is not read here, so
	// CreatedAt stays as the caller had it.
	if err := s.client.QueryRow(ctx, createIDPConnectionRevisionStmt,
		entity.ProjectID,
		revisionID,
		entity.ID,
		entity.Document,
	).Scan(&entity.UpdatedAt); err != nil {
		return idpconnection.ReviseNotFound(wrapError(err))
	}
	// pgx scans timestamptz in Local; reads normalize to UTC.
	entity.UpdatedAt = entity.UpdatedAt.UTC()
	entity.RevisionID = revisionID
	return nil
}

// GetIDPConnection implements [service.IDPConnectionStatements].
func (s idpConnectionStatements) GetIDPConnection(ctx context.Context, filter database.Filter[domain.IDPConnectionField]) (*domain.IDPConnection, error) {
	return s.getOne(ctx, filter, newestIDPRevision)
}

func (s idpConnectionStatements) getOne(ctx context.Context, filter database.Filter[domain.IDPConnectionField], conjuncts ...string) (*domain.IDPConnection, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, idpConnectionQuery, &database.ListOptions[domain.IDPConnectionField]{
		Filter: filter,
	}, idpconnection.Schema, conjuncts...); err != nil {
		return nil, err
	}

	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	entity, err := pgx.CollectExactlyOneRow(rows, scanIDPConnection)
	if err != nil {
		return nil, wrapError(err)
	}
	return entity, nil
}

// GetIDPConnectionRevision implements [service.IDPConnectionStatements].
func (s idpConnectionStatements) GetIDPConnectionRevision(ctx context.Context, projectID, revisionID string) (*domain.IDPConnection, error) {
	// No newest-revision conjunct: a pinned read must reach a superseded row.
	return s.getOne(ctx, database.And(
		database.Equal(database.Col(domain.IDPConnectionFieldProjectID), projectID),
		database.Equal(database.Col(domain.IDPConnectionFieldRevisionID), revisionID),
	))
}

// ListIDPConnections implements [service.IDPConnectionStatements].
func (s idpConnectionStatements) ListIDPConnections(ctx context.Context, filter *database.ListOptions[domain.IDPConnectionField]) (*database.ListResult[*domain.IDPConnection], error) {
	return s.list(ctx, idpconnection.EnsureListOptions(filter), newestIDPRevision)
}

// ListIDPConnectionRevisions implements [service.IDPConnectionStatements].
func (s idpConnectionStatements) ListIDPConnectionRevisions(ctx context.Context, projectID, connectionID string, page database.Page[domain.IDPConnectionField]) (*database.ListResult[*domain.IDPConnection], error) {
	return s.list(ctx, idpconnection.RevisionsListOptions(projectID, connectionID, page))
}

func (s idpConnectionStatements) list(ctx context.Context, opts *database.ListOptions[domain.IDPConnectionField], conjuncts ...string) (*database.ListResult[*domain.IDPConnection], error) {
	var compiler statementCompiler
	// compileList gets the alias `c`, not the table name: authz guards the
	// connection row, on the revision list too.
	if err := compileList(ctx, &compiler, idpConnectionQuery, opts, idpconnection.Schema, "c", "id", conjuncts...); err != nil {
		return nil, err
	}

	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	items, err := pgx.CollectRows(rows, scanIDPConnection)
	if err != nil {
		return nil, wrapError(err)
	}

	nextCursor := pagination.MarshalNext(
		opts.Pagination.OrderBy,
		items,
		idpconnection.Schema,
		opts.Pagination.Limit,
	)

	return &database.ListResult[*domain.IDPConnection]{
		Items:      items,
		NextCursor: nextCursor,
	}, nil
}

func scanIDPConnection(row pgx.CollectableRow) (*domain.IDPConnection, error) {
	entity := new(domain.IDPConnection)
	if err := row.Scan(
		&entity.ProjectID,
		&entity.ID,
		&entity.Slug,
		&entity.RevisionID,
		&entity.Document,
		&entity.CreatedAt,
		&entity.UpdatedAt,
	); err != nil {
		return nil, err
	}
	entity.CreatedAt, entity.UpdatedAt = entity.CreatedAt.UTC(), entity.UpdatedAt.UTC()
	return entity, nil
}

var _ service.IDPConnectionStatements = (*idpConnectionStatements)(nil)
