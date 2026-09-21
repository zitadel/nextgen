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

	// The revision's created_at is what every read serves as UpdatedAt, so the
	// insert hands it back rather than the caller guessing at it. It is also
	// the whole of a revise: nothing records the head (ADR 063 §7), so there is
	// no second write, and the composite foreign key is what reports an unknown
	// connection.
	createIDPConnectionRevisionStmt = `INSERT INTO idp_connection_revisions ` +
		`(project_id, id, connection_id, document) VALUES (@p1, @p2, @p3, @p4) THEN RETURN created_at`

	// One row per revision, carrying the connection's identity alongside it. The
	// aliases `c` and `r` are the ones idpconnection.Schema qualifies its column
	// names with, and the trailing r.created_at is the revision's birth, served
	// as UpdatedAt. A head read narrows this with newestIDPRevision; the history
	// reads page it as it stands, so a row there stands for the revision it was
	// read at.
	idpConnectionQuery = `SELECT c.project_id, c.id, c.slug, r.id, r.document, c.created_at, r.created_at
FROM idp_connections c
JOIN idp_connection_revisions r
  ON r.project_id = c.project_id AND r.connection_id = c.id`

	// newestIDPRevision keeps only the newest revision of each connection
	// (ADR 063 §7): nothing is stored to say which one that is, so a row is the
	// newest when no sibling of the same connection carries a greater
	// created_at.
	//
	// The uniqueness of (project_id, connection_id, created_at) makes created_at
	// a total order within a connection, so no tiebreak belongs in here.
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
		// A slug already taken in the project arrives here as a
		// *database.UniqueError; creating over an existing slug is the revise
		// path, so the service decides what to do with it.
		if err := tx.Write(ctx, stmt, scanIDPConnectionTimestamp(&entity.CreatedAt)); err != nil {
			return err
		}
		revision := buildStatement(createIDPConnectionRevisionStmt,
			entity.ProjectID,
			entity.RevisionID,
			entity.ID,
			document,
		).statement()
		// Spanner evaluates CURRENT_TIMESTAMP() per statement rather than per
		// transaction, so the first revision can land a few microseconds after
		// the connection row: UpdatedAt is read back rather than copied.
		if err := tx.Write(ctx, revision, scanIDPConnectionTimestamp(&entity.UpdatedAt)); err != nil {
			return err
		}
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindIDPConnection, entity.ProjectID, entity.ID))
	})
}

// ReviseIDPConnection implements [service.IDPConnectionStatements].
func (s idpConnectionStatements) ReviseIDPConnection(ctx context.Context, entity *domain.IDPConnection) error {
	// Minted unconditionally rather than through ensureManagedID: the entity
	// usually arrives from a get, carrying the revision it was read at, and
	// Ensure would keep that value and rewrite the revision instead of
	// appending one.
	revisionID, err := managedIDs.New(string(domain.PrefixIDPConnectionRevision))
	if err != nil {
		return err
	}
	document, err := encodeNullJSON(entity.Document)
	if err != nil {
		return wrapError(err)
	}
	// A single write, so no transaction to open: CreatedAt stays whatever the
	// caller brought, because the connection row is not read or touched here.
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
// normalized to UTC like every read does.
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

// GetIDPConnectionByID implements [service.IDPConnectionStatements].
//
// The head read is a join, so it goes through the compiler rather than ReadRow
// even though the filter is the connection's primary key.
func (s idpConnectionStatements) GetIDPConnectionByID(ctx context.Context, projectID, id string) (*domain.IDPConnection, error) {
	return s.getOne(ctx, database.And(
		database.Equal(database.Col(domain.IDPConnectionFieldProjectID), projectID),
		database.Equal(database.Col(domain.IDPConnectionFieldID), id),
	), newestIDPRevision)
}

// GetIDPConnectionBySlug implements [service.IDPConnectionStatements].
func (s idpConnectionStatements) GetIDPConnectionBySlug(ctx context.Context, projectID, slug string) (*domain.IDPConnection, error) {
	return s.getOne(ctx, database.And(
		database.Equal(database.Col(domain.IDPConnectionFieldProjectID), projectID),
		database.Equal(database.Col(domain.IDPConnectionFieldSlug), slug),
	), newestIDPRevision)
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
	// RevisionID binds r.id, the revision the caller pinned; ProjectID binds
	// c.project_id, which the join equates with the revision's own. No
	// newest-revision conjunct: a pin is precisely a read of a superseded row.
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
	// The alias rather than the table name: the authz EXISTS predicate has to
	// name the connection row the join already bound as `c`. That holds for the
	// revision list too, where what authz guards is the connection the
	// revisions hang off, not the revision rows.
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
