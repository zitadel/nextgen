package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/idpconnection"
)

const (
	createIDPConnectionStmt = `INSERT INTO idp_connections ` +
		`(project_id, id, slug, latest_revision_id, created_at) VALUES (?, ?, ?, ?, ?)`

	createIDPConnectionRevisionStmt = `INSERT INTO idp_connection_revisions ` +
		`(project_id, id, connection_id, document, created_at) VALUES (?, ?, ?, ?, ?)`

	// Moves the head pointer. RETURNING is what tells a missing connection
	// apart from a successful move, so revising an unknown connection fails
	// before the revision row is written; the value it returns is the
	// connection's birth, which every revision of it repeats.
	moveIDPConnectionHeadStmt = `UPDATE idp_connections SET ` +
		`latest_revision_id = ? WHERE project_id = ? AND id = ? RETURNING created_at`

	// The head-pointer join: the connection's identity with the document of the
	// revision it currently names. The aliases `c` and `r` are the ones
	// idpconnection.Schema qualifies its column names with, and the trailing
	// r.created_at is the revision's birth, served as UpdatedAt.
	idpConnectionQuery = `SELECT c.project_id, c.id, c.slug, r.id, r.document, c.created_at, r.created_at
FROM idp_connections c
JOIN idp_connection_revisions r
  ON r.project_id = c.project_id AND r.id = c.latest_revision_id`

	// The same shape walked from the revision side, so a row stands for the
	// revision it was read at rather than for the head. Both history reads use
	// it: the pinned get pins one revision, the list pages them.
	idpConnectionRevisionQuery = `SELECT c.project_id, c.id, c.slug, r.id, r.document, c.created_at, r.created_at
FROM idp_connection_revisions r
JOIN idp_connections c
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
	// One stamp for both rows: the connection's birth is also its first
	// revision's, so a fresh connection reports CreatedAt == UpdatedAt.
	now := nowUnixNano()
	return withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Exec(ctx, createIDPConnectionStmt,
			entity.ProjectID,
			entity.ID,
			entity.Slug,
			entity.RevisionID,
			now,
		); err != nil {
			// A slug already taken in the project arrives here as a
			// *database.UniqueError; creating over an existing slug is the
			// revise path, so the service decides what to do with it.
			return wrapError(err)
		}
		if _, err := tx.Exec(ctx, createIDPConnectionRevisionStmt,
			entity.ProjectID,
			entity.RevisionID,
			entity.ID,
			string(entity.Document),
			now,
		); err != nil {
			return wrapError(err)
		}
		entity.CreatedAt, entity.UpdatedAt = timeFromUnixNano(now), timeFromUnixNano(now)
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
	now := nowUnixNano()
	return withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		// Head first: it is the only statement that can report the connection
		// missing, and there is no foreign key on latest_revision_id to make
		// the order illegal.
		var createdNano int64
		if err := tx.QueryRow(ctx, moveIDPConnectionHeadStmt,
			revisionID,
			entity.ProjectID,
			entity.ID,
		).Scan(&createdNano); err != nil {
			return wrapError(err)
		}
		if _, err := tx.Exec(ctx, createIDPConnectionRevisionStmt,
			entity.ProjectID,
			revisionID,
			entity.ID,
			string(entity.Document),
			now,
		); err != nil {
			return wrapError(err)
		}
		entity.RevisionID = revisionID
		// The appended revision's stamp is the connection's new UpdatedAt.
		entity.CreatedAt, entity.UpdatedAt = timeFromUnixNano(createdNano), timeFromUnixNano(now)
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
	defer rows.Close()
	entity, err := collectExactlyOneRow(rows, scanIDPConnection)
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
	defer rows.Close()
	items, err := collectRows(rows, scanIDPConnection)
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

func scanIDPConnection(rows *sql.Rows) (*domain.IDPConnection, error) {
	var (
		entity                   domain.IDPConnection
		document                 string
		createdNano, updatedNano int64
	)
	if err := rows.Scan(
		&entity.ProjectID,
		&entity.ID,
		&entity.Slug,
		&entity.RevisionID,
		&document,
		&createdNano,
		&updatedNano,
	); err != nil {
		return nil, err
	}
	entity.Document = []byte(document)
	entity.CreatedAt, entity.UpdatedAt = timeFromUnixNano(createdNano), timeFromUnixNano(updatedNano)
	return &entity, nil
}

var _ service.IDPConnectionStatements = (*idpConnectionStatements)(nil)
