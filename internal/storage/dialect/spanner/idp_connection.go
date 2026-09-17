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
		`(project_id, id, slug, latest_revision_id) VALUES (@p1, @p2, @p3, @p4) THEN RETURN created_at, updated_at`

	createIDPConnectionRevisionStmt = `INSERT INTO idp_connection_revisions ` +
		`(project_id, id, connection_id, document) VALUES (@p1, @p2, @p3, @p4)`

	// Moves the head pointer. THEN RETURN is what tells a missing connection
	// apart from a successful move, so revising an unknown connection fails
	// before the revision row is written.
	moveIDPConnectionHeadStmt = `UPDATE idp_connections SET ` +
		`latest_revision_id = @p1, updated_at = CURRENT_TIMESTAMP() WHERE project_id = @p2 AND id = @p3 THEN RETURN created_at, updated_at`

	// The head-pointer join: the connection's identity with the document of the
	// revision it currently names. The aliases `c` and `r` are the ones
	// idpconnection.Schema qualifies its column names with.
	idpConnectionQuery = `SELECT c.project_id, c.id, c.slug, c.latest_revision_id, r.document, c.created_at, c.updated_at
FROM idp_connections c
JOIN idp_connection_revisions r
  ON r.project_id = c.project_id AND r.id = c.latest_revision_id`

	// The pinned read: the same shape, but the revision is the one asked for
	// rather than the one the head names, so it cannot go through the schema.
	getIDPConnectionRevisionStmt = `SELECT c.project_id, c.id, c.slug, r.id, r.document, c.created_at, c.updated_at
FROM idp_connection_revisions r
JOIN idp_connections c
  ON c.project_id = r.project_id AND c.id = r.connection_id
WHERE r.project_id = @p1 AND r.id = @p2`
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
			entity.RevisionID,
		).statement()
		// A slug already taken in the project arrives here as a
		// *database.UniqueError; the service maps it to idp.already_exists.
		if err := tx.Write(ctx, stmt, scanIDPConnectionTimestamps(entity)); err != nil {
			return err
		}
		revision := buildStatement(createIDPConnectionRevisionStmt,
			entity.ProjectID,
			entity.RevisionID,
			entity.ID,
			document,
		).statement()
		if _, err := tx.Update(ctx, revision); err != nil {
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
	return withTransaction(ctx, s.db, func(ctx context.Context, tx queryExecutor) error {
		// Head first: it is the only statement that can report the connection
		// missing, and there is no foreign key on latest_revision_id to make
		// the order illegal.
		head := buildStatement(moveIDPConnectionHeadStmt,
			revisionID,
			entity.ProjectID,
			entity.ID,
		).statement()
		if err := tx.Write(ctx, head, scanIDPConnectionTimestamps(entity)); err != nil {
			return err
		}
		revision := buildStatement(createIDPConnectionRevisionStmt,
			entity.ProjectID,
			revisionID,
			entity.ID,
			document,
		).statement()
		if _, err := tx.Update(ctx, revision); err != nil {
			return err
		}
		entity.RevisionID = revisionID
		return nil
	})
}

func scanIDPConnectionTimestamps(entity *domain.IDPConnection) func(*spanner.RowIterator) error {
	return func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			if err := row.Columns(&entity.CreatedAt, &entity.UpdatedAt); err != nil {
				return struct{}{}, err
			}
			entity.CreatedAt, entity.UpdatedAt = entity.CreatedAt.UTC(), entity.UpdatedAt.UTC()
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
	))
}

// GetIDPConnectionBySlug implements [service.IDPConnectionStatements].
func (s idpConnectionStatements) GetIDPConnectionBySlug(ctx context.Context, projectID, slug string) (*domain.IDPConnection, error) {
	return s.getOne(ctx, database.And(
		database.Equal(database.Col(domain.IDPConnectionFieldProjectID), projectID),
		database.Equal(database.Col(domain.IDPConnectionFieldSlug), slug),
	))
}

func (s idpConnectionStatements) getOne(ctx context.Context, filter database.Filter[domain.IDPConnectionField]) (*domain.IDPConnection, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, idpConnectionQuery, &database.ListOptions[domain.IDPConnectionField]{
		Filter: filter,
	}, idpconnection.Schema); err != nil {
		return nil, err
	}
	return s.queryOne(ctx, compiler.statement())
}

// GetIDPConnectionRevision implements [service.IDPConnectionStatements].
func (s idpConnectionStatements) GetIDPConnectionRevision(ctx context.Context, projectID, revisionID string) (*domain.IDPConnection, error) {
	return s.queryOne(ctx, buildStatement(getIDPConnectionRevisionStmt, projectID, revisionID).statement())
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
	opts := idpconnection.EnsureListOptions(filter)

	var compiler statementCompiler
	// The alias rather than the table name: the authz EXISTS predicate has to
	// name the connection row the join already bound as `c`.
	if err := compileList(ctx, &compiler, idpConnectionQuery, opts, idpconnection.Schema, "c", "id"); err != nil {
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
