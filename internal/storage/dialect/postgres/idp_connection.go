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
		`(project_id, id, slug, latest_revision_id) VALUES ($1, $2, $3, $4) RETURNING created_at`

	// The revision's created_at is what every read serves as UpdatedAt, so the
	// insert hands it back rather than the caller guessing at it.
	createIDPConnectionRevisionStmt = `INSERT INTO zitadel_nextgen.idp_connection_revisions ` +
		`(project_id, id, connection_id, document) VALUES ($1, $2, $3, $4) RETURNING created_at`

	// Moves the head pointer. RETURNING is what tells a missing connection
	// apart from a successful move, so revising an unknown connection fails
	// before the revision row is written; the value it returns is the
	// connection's birth, which every revision of it repeats.
	moveIDPConnectionHeadStmt = `UPDATE zitadel_nextgen.idp_connections SET ` +
		`latest_revision_id = $1 WHERE project_id = $2 AND id = $3 RETURNING created_at`

	// The head-pointer join: the connection's identity with the document of the
	// revision it currently names. The aliases `c` and `r` are the ones
	// idpconnection.Schema qualifies its column names with, and the trailing
	// r.created_at is the revision's birth, served as UpdatedAt.
	idpConnectionQuery = `SELECT c.project_id, c.id, c.slug, r.id, r.document, c.created_at, r.created_at
FROM zitadel_nextgen.idp_connections c
JOIN zitadel_nextgen.idp_connection_revisions r
  ON r.project_id = c.project_id AND r.id = c.latest_revision_id`

	// The same shape walked from the revision side, so a row stands for the
	// revision it was read at rather than for the head. Both history reads use
	// it: the pinned get pins one revision, the list pages them.
	idpConnectionRevisionQuery = `SELECT c.project_id, c.id, c.slug, r.id, r.document, c.created_at, r.created_at
FROM zitadel_nextgen.idp_connection_revisions r
JOIN zitadel_nextgen.idp_connections c
  ON c.project_id = r.project_id AND c.id = r.connection_id`
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
			entity.RevisionID,
		).Scan(&entity.CreatedAt); err != nil {
			// A slug already taken in the project arrives here as a
			// *database.UniqueError; creating over an existing slug is the
			// revise path, so the service decides what to do with it.
			return wrapError(err)
		}
		// Both defaults are NOW(), which postgres freezes for the transaction,
		// so a fresh connection reports CreatedAt == UpdatedAt.
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
	// Minted unconditionally rather than through ensureManagedID: the entity
	// usually arrives from a get, carrying the revision it was read at, and
	// Ensure would keep that value and rewrite the revision instead of
	// appending one.
	revisionID, err := managedIDs.New(string(domain.PrefixIDPConnectionRevision))
	if err != nil {
		return err
	}
	return withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		// Head first: it is the only statement that can report the connection
		// missing, and there is no foreign key on latest_revision_id to make
		// the order illegal.
		if err := tx.QueryRow(ctx, moveIDPConnectionHeadStmt,
			revisionID,
			entity.ProjectID,
			entity.ID,
		).Scan(&entity.CreatedAt); err != nil {
			return wrapError(err)
		}
		if err := tx.QueryRow(ctx, createIDPConnectionRevisionStmt,
			entity.ProjectID,
			revisionID,
			entity.ID,
			entity.Document,
		).Scan(&entity.UpdatedAt); err != nil {
			return wrapError(err)
		}
		entity.CreatedAt, entity.UpdatedAt = entity.CreatedAt.UTC(), entity.UpdatedAt.UTC()
		entity.RevisionID = revisionID
		return nil
	})
}

// GetIDPConnectionByID implements [service.IDPConnectionStatements].
func (s idpConnectionStatements) GetIDPConnectionByID(ctx context.Context, projectID, id string) (*domain.IDPConnection, error) {
	return s.getOne(ctx, idpConnectionQuery, database.And(
		database.Equal(database.Col(domain.IDPConnectionFieldProjectID), projectID),
		database.Equal(database.Col(domain.IDPConnectionFieldID), id),
	))
}

// GetIDPConnectionBySlug implements [service.IDPConnectionStatements].
func (s idpConnectionStatements) GetIDPConnectionBySlug(ctx context.Context, projectID, slug string) (*domain.IDPConnection, error) {
	return s.getOne(ctx, idpConnectionQuery, database.And(
		database.Equal(database.Col(domain.IDPConnectionFieldProjectID), projectID),
		database.Equal(database.Col(domain.IDPConnectionFieldSlug), slug),
	))
}

func (s idpConnectionStatements) getOne(ctx context.Context, query string, filter database.Filter[domain.IDPConnectionField]) (*domain.IDPConnection, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, query, &database.ListOptions[domain.IDPConnectionField]{
		Filter: filter,
	}, idpconnection.Schema); err != nil {
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
	// RevisionID binds r.id, the revision the caller pinned; ProjectID binds
	// c.project_id, which the join equates with the revision's own.
	return s.getOne(ctx, idpConnectionRevisionQuery, database.And(
		database.Equal(database.Col(domain.IDPConnectionFieldProjectID), projectID),
		database.Equal(database.Col(domain.IDPConnectionFieldRevisionID), revisionID),
	))
}

// ListIDPConnections implements [service.IDPConnectionStatements].
func (s idpConnectionStatements) ListIDPConnections(ctx context.Context, filter *database.ListOptions[domain.IDPConnectionField]) (*database.ListResult[*domain.IDPConnection], error) {
	return s.list(ctx, idpConnectionQuery, idpconnection.EnsureListOptions(filter))
}

// ListIDPConnectionRevisions implements [service.IDPConnectionStatements].
func (s idpConnectionStatements) ListIDPConnectionRevisions(ctx context.Context, projectID, connectionID string, page database.Page[domain.IDPConnectionField]) (*database.ListResult[*domain.IDPConnection], error) {
	return s.list(ctx, idpConnectionRevisionQuery, idpconnection.RevisionsListOptions(projectID, connectionID, page))
}

func (s idpConnectionStatements) list(ctx context.Context, query string, opts *database.ListOptions[domain.IDPConnectionField]) (*database.ListResult[*domain.IDPConnection], error) {
	var compiler statementCompiler
	// The alias rather than the table name: the authz EXISTS predicate has to
	// name the connection row the join already bound as `c`. That holds for the
	// revision list too, where what authz guards is the connection the
	// revisions hang off, not the revision rows.
	if err := compileList(ctx, &compiler, query, opts, idpconnection.Schema, "c", "id"); err != nil {
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
