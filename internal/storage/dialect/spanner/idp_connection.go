package spanner

import (
	"context"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/idpconnection"
)

const (
	createIDPConnectionStmt = `INSERT INTO idp_connections ` +
		`(project_id, id, slug) VALUES (@p1, @p2, @p3) THEN RETURN created_at`

	// The revision's created_at is served as UpdatedAt, so the insert returns
	// it. This is also the whole of a revise, where the foreign key on
	// (project_id, connection_id) reports an unknown connection.
	createIDPConnectionRevisionStmt = `INSERT INTO idp_connection_revisions ` +
		`(project_id, id, connection_id, document) VALUES (@p1, @p2, @p3, @p4) THEN RETURN created_at`

	// Spanner evaluates CURRENT_TIMESTAMP() per statement, so the first
	// revision binds the connection's stamp. A default would land after it and
	// a connection nobody revised would look edited.
	createFirstIDPConnectionRevisionStmt = `INSERT INTO idp_connection_revisions ` +
		`(project_id, id, connection_id, document, created_at) VALUES (@p1, @p2, @p3, @p4, @p5)`

	// One row per revision, carrying its connection's identity. The last column
	// is the revision's created_at, which reads serve as UpdatedAt.
	idpConnectionQuery = `SELECT c.project_id, c.id, c.slug, r.id, r.document, c.created_at, r.created_at
FROM idp_connections c
JOIN idp_connection_revisions r
  ON r.project_id = c.project_id AND r.connection_id = c.id`

	// Nothing stores which revision is newest (ADR 063 §7), so a row is newest
	// when no sibling of the same connection has a greater created_at. The
	// unique index on (project_id, connection_id, created_at) makes that a
	// total order, so no tiebreak is needed here.
	newestIDPRevision = `NOT EXISTS (SELECT 1 FROM idp_connection_revisions AS newer` +
		` WHERE newer.project_id = r.project_id` +
		` AND newer.connection_id = r.connection_id` +
		` AND newer.created_at > r.created_at)`
)

type idpConnectionStatements struct{ statement }

func newIDPConnectionStatements(db queryExecutor) idpConnectionStatements {
	return idpConnectionStatements{statement: statement{db: db}}
}

// CreateIDPConnection implements [service.IDPConnectionStatements].
func (s idpConnectionStatements) CreateIDPConnection(ctx context.Context, entity *domain.IDPConnection) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixIDPConnection); err != nil {
		return err
	}
	if err := ensureManagedID(&entity.RevisionID, domain.PrefixIDPConnectionRevision); err != nil {
		return err
	}
	document, err := encodeNullJSON(entity.Document)
	if err != nil {
		return wrapError(err)
	}
	return withTransaction(ctx, s.db, func(ctx context.Context, tx queryExecutor) error {
		stmt := buildStatement(createIDPConnectionStmt,
			entity.ProjectID,
			entity.ID,
			entity.Slug,
		).statement()
		// A retry replays this callback, so the stamp stays local: the revision
		// insert must bind the value this attempt returned, not one an earlier
		// attempt left on the entity.
		var createdAt time.Time
		if err := tx.Write(ctx, stmt, scanIDPConnectionTimestamp(&createdAt)); err != nil {
			return err
		}
		revision := buildStatement(createFirstIDPConnectionRevisionStmt,
			entity.ProjectID,
			entity.RevisionID,
			entity.ID,
			document,
			createdAt,
		).statement()
		if _, err := tx.Update(ctx, revision); err != nil {
			return err
		}
		// One stamp for both rows, so a connection nobody revised reports
		// CreatedAt == UpdatedAt.
		entity.CreatedAt, entity.UpdatedAt = createdAt, createdAt
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
	document, err := encodeNullJSON(entity.Document)
	if err != nil {
		return wrapError(err)
	}
	// One insert, so no transaction. The connection row is not read here, so
	// CreatedAt stays as the caller had it.
	revision := buildStatement(createIDPConnectionRevisionStmt,
		entity.ProjectID,
		revisionID,
		entity.ID,
		document,
	).statement()
	if err := s.db.Write(ctx, revision, scanIDPConnectionTimestamp(&entity.UpdatedAt)); err != nil {
		return idpconnection.ReviseNotFound(err)
	}
	entity.RevisionID = revisionID
	return nil
}

// scanIDPConnectionTimestamp reads the created_at a write returned into dst,
// in UTC like the reads.
func scanIDPConnectionTimestamp(dst *time.Time) func(*spanner.RowIterator) error {
	return func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			if err := row.Columns(dst); err != nil {
				return struct{}{}, err
			}
			*dst = dst.UTC()
			return struct{}{}, nil
		})
		return err
	}
}

// GetIDPConnection implements [service.IDPConnectionStatements].
//
// The read is a join, so it goes through the compiler rather than ReadRow.
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
	return s.queryOne(ctx, compiler.statement())
}

// GetIDPConnectionRevision implements [service.IDPConnectionStatements].
func (s idpConnectionStatements) GetIDPConnectionRevision(ctx context.Context, projectID, revisionID string) (*domain.IDPConnection, error) {
	// No newest-revision conjunct: a pinned read must reach a superseded row.
	return s.getOne(ctx, database.And(
		database.Equal(database.Col(domain.IDPConnectionFieldProjectID), projectID),
		database.Equal(database.Col(domain.IDPConnectionFieldRevisionID), revisionID),
	))
}

func (s idpConnectionStatements) queryOne(ctx context.Context, stmt spanner.Statement) (*domain.IDPConnection, error) {
	var entity *domain.IDPConnection
	if err := s.db.Query(ctx, stmt, func(iter *spanner.RowIterator) error {
		var err error
		entity, err = collectOneRow(iter, scanIDPConnection)
		return err
	}); err != nil {
		return nil, err
	}
	return entity, nil
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

	var items []*domain.IDPConnection
	if err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, scanIDPConnection)
		return err
	}); err != nil {
		return nil, err
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

func scanIDPConnection(row *spanner.Row) (*domain.IDPConnection, error) {
	var (
		entity               domain.IDPConnection
		documentJSON         spanner.NullJSON
		createdAt, updatedAt time.Time
	)
	if err := row.Columns(
		&entity.ProjectID,
		&entity.ID,
		&entity.Slug,
		&entity.RevisionID,
		&documentJSON,
		&createdAt,
		&updatedAt,
	); err != nil {
		return nil, err
	}
	document, err := decodeNullJSON(documentJSON)
	if err != nil {
		return nil, wrapError(err)
	}
	entity.Document = document
	entity.CreatedAt, entity.UpdatedAt = createdAt.UTC(), updatedAt.UTC()
	return &entity, nil
}

var _ service.IDPConnectionStatements = (*idpConnectionStatements)(nil)
