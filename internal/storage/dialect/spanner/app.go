package spanner

import (
	"context"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/appstore"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	createAppStmt = `INSERT INTO apps (project_id, id, slug, source) VALUES (@p1, @p2, @p3, @p4) THEN RETURN created_at`

	// Also the whole of a revise, where the foreign key on (project_id,
	// app_id) reports an unknown app. The default CURRENT_TIMESTAMP() is
	// taken when this statement runs, after the revise read the app row, so
	// revision order follows lock order.
	createAppRevisionStmt = `INSERT INTO app_revisions ` +
		`(project_id, id, app_id, document) VALUES (@p1, @p2, @p3, @p4) THEN RETURN created_at`

	// CURRENT_TIMESTAMP() is per statement, so the first revision binds the
	// app's stamp; a default would land after it and the app would look
	// edited.
	createFirstAppRevisionStmt = `INSERT INTO app_revisions ` +
		`(project_id, id, app_id, document, created_at) VALUES (@p1, @p2, @p3, @p4, @p5)`

	lockAppStmt = `SELECT id FROM apps WHERE project_id = @p1 AND id = @p2 FOR UPDATE`

	appQuery = `SELECT a.project_id, a.id, a.slug, a.source, r.id, r.document, a.created_at, r.created_at
FROM apps a
JOIN app_revisions r
  ON r.project_id = a.project_id AND r.app_id = a.id`

	newestAppRevision = `NOT EXISTS (SELECT 1 FROM app_revisions AS newer` +
		` WHERE newer.project_id = r.project_id` +
		` AND newer.app_id = r.app_id` +
		` AND newer.created_at > r.created_at)`

	createAppClientIDStmt = `INSERT INTO app_clients ` +
		`(project_id, id, app_id, slug, client_id) VALUES (@p1, @p2, @p3, @p4, @p5) THEN RETURN created_at`

	appClientIDColumns = `SELECT project_id, id, app_id, slug, client_id, created_at FROM app_clients`

	listAppClientIDsStmt = appClientIDColumns + ` WHERE project_id = @p1 AND app_id = @p2 ORDER BY created_at, id`

	getAppClientIDByClientIDStmt = appClientIDColumns + ` WHERE project_id = @p1 AND client_id = @p2`

	createAppAPIIdentifierStmt = `INSERT INTO app_api_identifiers ` +
		`(project_id, identifier, app_id) VALUES (@p1, @p2, @p3) THEN RETURN created_at`

	getAppAPIIdentifierStmt = `SELECT project_id, identifier, app_id, created_at ` +
		`FROM app_api_identifiers WHERE project_id = @p1 AND identifier = @p2`

	createAppClientSecretStmt = `INSERT INTO app_client_secrets ` +
		`(project_id, id, client_row_id, encoded_hash) VALUES (@p1, @p2, @p3, @p4) THEN RETURN created_at`

	listAppClientSecretsStmt = `SELECT project_id, id, client_row_id, encoded_hash, created_at ` +
		`FROM app_client_secrets WHERE project_id = @p1 AND client_row_id = @p2 ` +
		`ORDER BY created_at DESC, id DESC`

	updateAppClientSecretHashStmt = `UPDATE app_client_secrets SET encoded_hash = @p3 WHERE project_id = @p1 AND id = @p2`
)

type appStatements struct{ statement }

func newAppStatements(db queryExecutor) appStatements {
	return appStatements{statement: statement{db: db}}
}

// CreateApp implements [service.AppStatements].
func (s appStatements) CreateApp(ctx context.Context, entity *domain.App) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixApp); err != nil {
		return err
	}
	if err := ensureManagedID(&entity.RevisionID, domain.PrefixAppRevision); err != nil {
		return err
	}
	document, err := encodeNullJSON(entity.Document)
	if err != nil {
		return wrapError(err)
	}
	return withTransaction(ctx, s.db, func(ctx context.Context, tx queryExecutor) error {
		stmt := buildStatement(createAppStmt,
			entity.ProjectID,
			entity.ID,
			entity.Slug,
			string(entity.Source),
		).statement()
		// A retry replays this callback, so the stamp stays local.
		var createdAt time.Time
		if err := tx.Write(ctx, stmt, scanReturnedTimestamp(&createdAt)); err != nil {
			return err
		}
		revision := buildStatement(createFirstAppRevisionStmt,
			entity.ProjectID,
			entity.RevisionID,
			entity.ID,
			document,
			createdAt,
		).statement()
		if _, err := tx.Update(ctx, revision); err != nil {
			return err
		}
		entity.CreatedAt, entity.UpdatedAt = createdAt, createdAt
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindApp, entity.ProjectID, entity.ID))
	})
}

// ReviseApp implements [service.AppStatements].
func (s appStatements) ReviseApp(ctx context.Context, entity *domain.App) error {
	revisionID, err := managedIDs.New(string(domain.PrefixAppRevision))
	if err != nil {
		return err
	}
	document, err := encodeNullJSON(entity.Document)
	if err != nil {
		return wrapError(err)
	}
	revision := buildStatement(createAppRevisionStmt,
		entity.ProjectID,
		revisionID,
		entity.ID,
		document,
	).statement()
	if err := s.db.Write(ctx, revision, scanReturnedTimestamp(&entity.UpdatedAt)); err != nil {
		return appstore.ReviseNotFound(err)
	}
	entity.RevisionID = revisionID
	return nil
}

// LockApp implements [service.AppStatements]. FOR UPDATE takes the exclusive
// lock that serializes revisions of one app, as LockIDPConnection does.
func (s appStatements) LockApp(ctx context.Context, projectID, id string) error {
	return s.db.Query(ctx, buildStatement(lockAppStmt, projectID, id).statement(), func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(*spanner.Row) (struct{}, error) { return struct{}{}, nil })
		return err
	})
}

// GetApp implements [service.AppStatements].
func (s appStatements) GetApp(ctx context.Context, filter database.Filter[domain.AppField]) (*domain.App, error) {
	return s.getOne(ctx, filter, newestAppRevision)
}

func (s appStatements) getOne(ctx context.Context, filter database.Filter[domain.AppField], conjuncts ...string) (*domain.App, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, appQuery, &database.ListOptions[domain.AppField]{
		Filter: filter,
	}, appstore.Schema, conjuncts...); err != nil {
		return nil, err
	}
	var entity *domain.App
	if err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		entity, err = collectOneRow(iter, scanApp)
		return err
	}); err != nil {
		return nil, err
	}
	return entity, nil
}

// GetAppRevision implements [service.AppStatements].
func (s appStatements) GetAppRevision(ctx context.Context, projectID, revisionID string) (*domain.App, error) {
	return s.getOne(ctx, database.And(
		database.Equal(database.Col(domain.AppFieldProjectID), projectID),
		database.Equal(database.Col(domain.AppFieldRevisionID), revisionID),
	))
}

// ListApps implements [service.AppStatements].
func (s appStatements) ListApps(ctx context.Context, filter *database.ListOptions[domain.AppField]) (*database.ListResult[*domain.App], error) {
	return s.list(ctx, appstore.EnsureListOptions(filter), newestAppRevision)
}

// ListAppRevisions implements [service.AppStatements].
func (s appStatements) ListAppRevisions(ctx context.Context, projectID, appID string, page database.Page[domain.AppField]) (*database.ListResult[*domain.App], error) {
	return s.list(ctx, appstore.RevisionsListOptions(projectID, appID, page))
}

func (s appStatements) list(ctx context.Context, opts *database.ListOptions[domain.AppField], conjuncts ...string) (*database.ListResult[*domain.App], error) {
	items, nextCursor, err := pagination.Page(opts.Pagination, appstore.Schema, func(limit uint32) ([]*domain.App, error) {
		opts := opts.WithLimit(limit)
		var compiler statementCompiler
		if err := compileList(ctx, &compiler, appQuery, opts, appstore.Schema, "a", "id", conjuncts...); err != nil {
			return nil, err
		}
		var items []*domain.App
		if err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
			var err error
			items, err = collectRows(iter, scanApp)
			return err
		}); err != nil {
			return nil, err
		}
		return items, nil
	})
	if err != nil {
		return nil, err
	}
	return &database.ListResult[*domain.App]{Items: items, NextCursor: nextCursor}, nil
}

func scanApp(row *spanner.Row) (*domain.App, error) {
	var (
		entity               domain.App
		source               string
		documentJSON         spanner.NullJSON
		createdAt, updatedAt time.Time
	)
	if err := row.Columns(
		&entity.ProjectID,
		&entity.ID,
		&entity.Slug,
		&source,
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
	entity.Source = domain.AppSource(source)
	entity.Document = document
	entity.CreatedAt, entity.UpdatedAt = createdAt.UTC(), updatedAt.UTC()
	return &entity, nil
}

// CreateAppClientID implements [service.AppStatements].
func (s appStatements) CreateAppClientID(ctx context.Context, entity *domain.AppClientID) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixAppClient); err != nil {
		return err
	}
	if entity.ClientID == "" {
		entity.ClientID = entity.ID
	}
	stmt := buildStatement(createAppClientIDStmt,
		entity.ProjectID,
		entity.ID,
		entity.AppID,
		entity.Slug,
		entity.ClientID,
	).statement()
	return s.db.Write(ctx, stmt, scanReturnedTimestamp(&entity.CreatedAt))
}

// ListAppClientIDs implements [service.AppStatements].
func (s appStatements) ListAppClientIDs(ctx context.Context, projectID, appID string) ([]*domain.AppClientID, error) {
	var items []*domain.AppClientID
	err := s.db.Query(ctx, buildStatement(listAppClientIDsStmt, projectID, appID).statement(), func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, scanAppClientID)
		return err
	})
	return items, err
}

// GetAppClientIDByClientID implements [service.AppStatements].
func (s appStatements) GetAppClientIDByClientID(ctx context.Context, projectID, clientID string) (*domain.AppClientID, error) {
	var entity *domain.AppClientID
	err := s.db.Query(ctx, buildStatement(getAppClientIDByClientIDStmt, projectID, clientID).statement(), func(iter *spanner.RowIterator) error {
		var err error
		entity, err = collectOneRow(iter, scanAppClientID)
		return err
	})
	return entity, err
}

func scanAppClientID(row *spanner.Row) (*domain.AppClientID, error) {
	var entity domain.AppClientID
	if err := row.Columns(&entity.ProjectID, &entity.ID, &entity.AppID, &entity.Slug, &entity.ClientID, &entity.CreatedAt); err != nil {
		return nil, err
	}
	entity.CreatedAt = entity.CreatedAt.UTC()
	return &entity, nil
}

// CreateAppAPIIdentifier implements [service.AppStatements].
func (s appStatements) CreateAppAPIIdentifier(ctx context.Context, entity *domain.AppAPIIdentifier) error {
	stmt := buildStatement(createAppAPIIdentifierStmt,
		entity.ProjectID,
		entity.Identifier,
		entity.AppID,
	).statement()
	return s.db.Write(ctx, stmt, scanReturnedTimestamp(&entity.CreatedAt))
}

// GetAppAPIIdentifier implements [service.AppStatements].
func (s appStatements) GetAppAPIIdentifier(ctx context.Context, projectID, identifier string) (*domain.AppAPIIdentifier, error) {
	var entity *domain.AppAPIIdentifier
	err := s.db.Query(ctx, buildStatement(getAppAPIIdentifierStmt, projectID, identifier).statement(), func(iter *spanner.RowIterator) error {
		var err error
		entity, err = collectOneRow(iter, func(row *spanner.Row) (*domain.AppAPIIdentifier, error) {
			var e domain.AppAPIIdentifier
			if err := row.Columns(&e.ProjectID, &e.Identifier, &e.AppID, &e.CreatedAt); err != nil {
				return nil, err
			}
			e.CreatedAt = e.CreatedAt.UTC()
			return &e, nil
		})
		return err
	})
	return entity, err
}

// CreateAppClientSecret implements [service.AppStatements].
func (s appStatements) CreateAppClientSecret(ctx context.Context, entity *domain.AppClientSecret) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixAppClientSecret); err != nil {
		return err
	}
	stmt := buildStatement(createAppClientSecretStmt,
		entity.ProjectID,
		entity.ID,
		entity.ClientRowID,
		entity.EncodedHash,
	).statement()
	return s.db.Write(ctx, stmt, scanReturnedTimestamp(&entity.CreatedAt))
}

// ListAppClientSecrets implements [service.AppStatements].
func (s appStatements) ListAppClientSecrets(ctx context.Context, projectID, clientRowID string) ([]*domain.AppClientSecret, error) {
	var items []*domain.AppClientSecret
	err := s.db.Query(ctx, buildStatement(listAppClientSecretsStmt, projectID, clientRowID).statement(), func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, func(row *spanner.Row) (*domain.AppClientSecret, error) {
			var e domain.AppClientSecret
			if err := row.Columns(&e.ProjectID, &e.ID, &e.ClientRowID, &e.EncodedHash, &e.CreatedAt); err != nil {
				return nil, err
			}
			e.CreatedAt = e.CreatedAt.UTC()
			return &e, nil
		})
		return err
	})
	return items, err
}

// UpdateAppClientSecretHash implements [service.AppStatements].
func (s appStatements) UpdateAppClientSecretHash(ctx context.Context, projectID, id, encodedHash string) error {
	n, err := s.db.Update(ctx, buildStatement(updateAppClientSecretHashStmt, projectID, id, encodedHash).statement())
	if err != nil {
		return wrapError(err)
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

var _ service.AppStatements = (*appStatements)(nil)
