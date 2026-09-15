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
		`(project_id, id, slug, latest_revision_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`

	createIDPConnectionRevisionStmt = `INSERT INTO idp_connection_revisions ` +
		`(project_id, id, connection_id, document, created_at) VALUES (?, ?, ?, ?, ?)`

	// Moves the head pointer. RETURNING is what tells a missing connection
	// apart from a successful move, so revising an unknown connection fails
	// before the revision row is written.
	moveIDPConnectionHeadStmt = `UPDATE idp_connections SET ` +
		`latest_revision_id = ?, updated_at = ? WHERE project_id = ? AND id = ? RETURNING created_at, updated_at`

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
WHERE r.project_id = ? AND r.id = ?`
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
	// One stamp for all three columns: a fresh connection reports
	// CreatedAt == UpdatedAt, and the revision shares the instant it was
	// created with.
	now := nowUnixNano()
	return withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Exec(ctx, createIDPConnectionStmt,
			entity.ProjectID,
			entity.ID,
			entity.Slug,
			entity.RevisionID,
			now,
			now,
		); err != nil {
			// A slug already taken in the project arrives here as a
			// *database.UniqueError; the service maps it to idp.already_exists.
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
		var createdNano, updatedNano int64
		if err := tx.QueryRow(ctx, moveIDPConnectionHeadStmt,
			revisionID,
			now,
			entity.ProjectID,
			entity.ID,
		).Scan(&createdNano, &updatedNano); err != nil {
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
		entity.CreatedAt, entity.UpdatedAt = timeFromUnixNano(createdNano), timeFromUnixNano(updatedNano)
		return nil
	})
}

// GetIDPConnectionByID implements [service.IDPConnectionStatements].
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
	rows, err := s.client.Query(ctx, getIDPConnectionRevisionStmt, projectID, revisionID)
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

// ListIDPConnections implements [service.IDPConnectionStatements].
func (s idpConnectionStatements) ListIDPConnections(ctx context.Context, filter *database.ListOptions[domain.IDPConnectionField]) (*database.ListResult[*domain.IDPConnection], error) {
	opts := idpconnection.EnsureListOptions(filter)

	var compiler statementCompiler
	// The alias rather than the table name: the authz EXISTS predicate has to
	// name the connection row the join already bound as `c`.
	if err := compileList(ctx, &compiler, idpConnectionQuery, opts, idpconnection.Schema, "c", "id"); err != nil {
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
