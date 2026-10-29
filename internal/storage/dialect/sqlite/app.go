package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/appstore"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	createAppStmt = `INSERT INTO apps (project_id, id, slug, source, created_at) VALUES (?, ?, ?, ?, ?)`

	// Also the whole of a revise, where the foreign key on (project_id,
	// app_id) reports an unknown app.
	createAppRevisionStmt = `INSERT INTO app_revisions ` +
		`(project_id, id, app_id, document, created_at) VALUES (?, ?, ?, ?, ?)`

	// No FOR UPDATE: every transaction begins with BEGIN IMMEDIATE on a single
	// connection, so the write lock is held from BEGIN and a second revise
	// waits for the first to commit. The select only reports an unknown app.
	lockAppStmt = `SELECT id FROM apps WHERE project_id = ? AND id = ?`

	appQuery = `SELECT a.project_id, a.id, a.slug, a.source, r.id, r.document, a.created_at, r.created_at
FROM apps a
JOIN app_revisions r
  ON r.project_id = a.project_id AND r.app_id = a.id`

	newestAppRevision = `NOT EXISTS (SELECT 1 FROM app_revisions AS newer` +
		` WHERE newer.project_id = r.project_id` +
		` AND newer.app_id = r.app_id` +
		` AND newer.created_at > r.created_at)`

	createAppClientIDStmt = `INSERT INTO app_clients ` +
		`(project_id, id, app_id, slug, client_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`

	appClientIDColumns = `SELECT project_id, id, app_id, slug, client_id, created_at FROM app_clients`

	listAppClientIDsStmt = appClientIDColumns + ` WHERE project_id = ? AND app_id = ? ORDER BY created_at, id`

	getAppClientIDByClientIDStmt = appClientIDColumns + ` WHERE project_id = ? AND client_id = ?`

	createAppAPIIdentifierStmt = `INSERT INTO app_api_identifiers ` +
		`(project_id, identifier, app_id, created_at) VALUES (?, ?, ?, ?)`

	getAppAPIIdentifierStmt = `SELECT project_id, identifier, app_id, created_at ` +
		`FROM app_api_identifiers WHERE project_id = ? AND identifier = ?`

	createAppClientSecretStmt = `INSERT INTO app_client_secrets ` +
		`(project_id, id, client_row_id, encoded_hash, created_at) VALUES (?, ?, ?, ?, ?)`

	listAppClientSecretsStmt = `SELECT project_id, id, client_row_id, encoded_hash, created_at ` +
		`FROM app_client_secrets WHERE project_id = ? AND client_row_id = ? ` +
		`ORDER BY created_at DESC, id DESC`

	updateAppClientSecretHashStmt = `UPDATE app_client_secrets SET encoded_hash = ? WHERE project_id = ? AND id = ?`
)

type appStatements struct{ statement }

func newAppStatements(client queryExecutor) appStatements {
	return appStatements{statement: statement{client: client}}
}

// CreateApp implements [service.AppStatements].
func (s appStatements) CreateApp(ctx context.Context, entity *domain.App) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixApp); err != nil {
		return err
	}
	if err := ensureManagedID(&entity.RevisionID, domain.PrefixAppRevision); err != nil {
		return err
	}
	// One stamp for both rows, so an app nobody revised reports
	// CreatedAt == UpdatedAt.
	now := nowUnixNano()
	return withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Exec(ctx, createAppStmt,
			entity.ProjectID,
			entity.ID,
			entity.Slug,
			string(entity.Source),
			now,
		); err != nil {
			return wrapError(err)
		}
		if _, err := tx.Exec(ctx, createAppRevisionStmt,
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
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindApp, entity.ProjectID, entity.ID))
	})
}

// ReviseApp implements [service.AppStatements].
func (s appStatements) ReviseApp(ctx context.Context, entity *domain.App) error {
	revisionID, err := managedIDs.New(string(domain.PrefixAppRevision))
	if err != nil {
		return err
	}
	// Stamped at the insert, inside a transaction BEGIN IMMEDIATE already
	// serialized, so revision order follows transaction order.
	now := nowUnixNano()
	if _, err := s.client.Exec(ctx, createAppRevisionStmt,
		entity.ProjectID,
		revisionID,
		entity.ID,
		string(entity.Document),
		now,
	); err != nil {
		return appstore.ReviseNotFound(wrapError(err))
	}
	entity.RevisionID = revisionID
	entity.UpdatedAt = timeFromUnixNano(now)
	return nil
}

// LockApp implements [service.AppStatements].
func (s appStatements) LockApp(ctx context.Context, projectID, id string) error {
	var locked string
	return wrapError(s.client.QueryRow(ctx, lockAppStmt, projectID, id).Scan(&locked))
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
	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	entity, err := collectExactlyOneRow(rows, scanApp)
	if err != nil {
		return nil, wrapError(err)
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
		rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
		if err != nil {
			return nil, wrapError(err)
		}
		defer rows.Close()
		items, err := collectRows(rows, scanApp)
		if err != nil {
			return nil, wrapError(err)
		}
		return items, nil
	})
	if err != nil {
		return nil, err
	}
	return &database.ListResult[*domain.App]{Items: items, NextCursor: nextCursor}, nil
}

func scanApp(rows *sql.Rows) (*domain.App, error) {
	var (
		entity                   domain.App
		source, document         string
		createdNano, updatedNano int64
	)
	if err := rows.Scan(
		&entity.ProjectID,
		&entity.ID,
		&entity.Slug,
		&source,
		&entity.RevisionID,
		&document,
		&createdNano,
		&updatedNano,
	); err != nil {
		return nil, err
	}
	entity.Source = domain.AppSource(source)
	entity.Document = []byte(document)
	entity.CreatedAt, entity.UpdatedAt = timeFromUnixNano(createdNano), timeFromUnixNano(updatedNano)
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
	now := nowUnixNano()
	if _, err := s.client.Exec(ctx, createAppClientIDStmt,
		entity.ProjectID,
		entity.ID,
		entity.AppID,
		entity.Slug,
		entity.ClientID,
		now,
	); err != nil {
		return wrapError(err)
	}
	entity.CreatedAt = timeFromUnixNano(now)
	return nil
}

// ListAppClientIDs implements [service.AppStatements].
func (s appStatements) ListAppClientIDs(ctx context.Context, projectID, appID string) ([]*domain.AppClientID, error) {
	rows, err := s.client.Query(ctx, listAppClientIDsStmt, projectID, appID)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	items, err := collectRows(rows, scanAppClientID)
	if err != nil {
		return nil, wrapError(err)
	}
	return items, nil
}

// GetAppClientIDByClientID implements [service.AppStatements].
func (s appStatements) GetAppClientIDByClientID(ctx context.Context, projectID, clientID string) (*domain.AppClientID, error) {
	rows, err := s.client.Query(ctx, getAppClientIDByClientIDStmt, projectID, clientID)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	entity, err := collectExactlyOneRow(rows, scanAppClientID)
	if err != nil {
		return nil, wrapError(err)
	}
	return entity, nil
}

func scanAppClientID(rows *sql.Rows) (*domain.AppClientID, error) {
	var (
		entity      domain.AppClientID
		createdNano int64
	)
	if err := rows.Scan(&entity.ProjectID, &entity.ID, &entity.AppID, &entity.Slug, &entity.ClientID, &createdNano); err != nil {
		return nil, err
	}
	entity.CreatedAt = timeFromUnixNano(createdNano)
	return &entity, nil
}

// CreateAppAPIIdentifier implements [service.AppStatements].
func (s appStatements) CreateAppAPIIdentifier(ctx context.Context, entity *domain.AppAPIIdentifier) error {
	now := nowUnixNano()
	if _, err := s.client.Exec(ctx, createAppAPIIdentifierStmt,
		entity.ProjectID,
		entity.Identifier,
		entity.AppID,
		now,
	); err != nil {
		return wrapError(err)
	}
	entity.CreatedAt = timeFromUnixNano(now)
	return nil
}

// GetAppAPIIdentifier implements [service.AppStatements].
func (s appStatements) GetAppAPIIdentifier(ctx context.Context, projectID, identifier string) (*domain.AppAPIIdentifier, error) {
	var (
		entity      domain.AppAPIIdentifier
		createdNano int64
	)
	if err := s.client.QueryRow(ctx, getAppAPIIdentifierStmt, projectID, identifier).
		Scan(&entity.ProjectID, &entity.Identifier, &entity.AppID, &createdNano); err != nil {
		return nil, wrapError(err)
	}
	entity.CreatedAt = timeFromUnixNano(createdNano)
	return &entity, nil
}

// CreateAppClientSecret implements [service.AppStatements].
func (s appStatements) CreateAppClientSecret(ctx context.Context, entity *domain.AppClientSecret) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixAppClientSecret); err != nil {
		return err
	}
	now := nowUnixNano()
	if _, err := s.client.Exec(ctx, createAppClientSecretStmt,
		entity.ProjectID,
		entity.ID,
		entity.ClientRowID,
		entity.EncodedHash,
		now,
	); err != nil {
		return wrapError(err)
	}
	entity.CreatedAt = timeFromUnixNano(now)
	return nil
}

// ListAppClientSecrets implements [service.AppStatements].
func (s appStatements) ListAppClientSecrets(ctx context.Context, projectID, clientRowID string) ([]*domain.AppClientSecret, error) {
	rows, err := s.client.Query(ctx, listAppClientSecretsStmt, projectID, clientRowID)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	items, err := collectRows(rows, func(rows *sql.Rows) (*domain.AppClientSecret, error) {
		var (
			entity      domain.AppClientSecret
			createdNano int64
		)
		if err := rows.Scan(&entity.ProjectID, &entity.ID, &entity.ClientRowID, &entity.EncodedHash, &createdNano); err != nil {
			return nil, err
		}
		entity.CreatedAt = timeFromUnixNano(createdNano)
		return &entity, nil
	})
	if err != nil {
		return nil, wrapError(err)
	}
	return items, nil
}

// UpdateAppClientSecretHash implements [service.AppStatements].
func (s appStatements) UpdateAppClientSecretHash(ctx context.Context, projectID, id, encodedHash string) error {
	n, err := execAffected(ctx, s.client, updateAppClientSecretHashStmt, encodedHash, projectID, id)
	if err != nil {
		return err
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

var _ service.AppStatements = (*appStatements)(nil)
