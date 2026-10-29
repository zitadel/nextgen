package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/appstore"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	createAppStmt = `INSERT INTO zitadel_nextgen.apps ` +
		`(project_id, id, slug, source) VALUES ($1, $2, $3, $4) RETURNING created_at`

	// The first revision takes the column default now(), the app row's
	// transaction timestamp, so an app nobody revised reports
	// CreatedAt == UpdatedAt.
	createAppRevisionStmt = `INSERT INTO zitadel_nextgen.app_revisions ` +
		`(project_id, id, app_id, document) VALUES ($1, $2, $3, $4) RETURNING created_at`

	// clock_timestamp(), not now(), as for connections: a revise that began
	// before a concurrent one but took the app lock after it must still stamp
	// a later time than the revision it follows.
	reviseAppStmt = `INSERT INTO zitadel_nextgen.app_revisions ` +
		`(project_id, id, app_id, document, created_at) VALUES ($1, $2, $3, $4, clock_timestamp()) RETURNING created_at`

	// FOR UPDATE holds the app row until the transaction ends, so a second
	// revise of the same app waits here and then reads the first one's
	// revision as newest.
	lockAppStmt = `SELECT id FROM zitadel_nextgen.apps WHERE project_id = $1 AND id = $2 FOR UPDATE`

	// One row per revision, carrying its app's identity. The last column is
	// the revision's created_at, which reads serve as UpdatedAt.
	appQuery = `SELECT a.project_id, a.id, a.slug, a.source, r.id, r.document, a.created_at, r.created_at
FROM zitadel_nextgen.apps a
JOIN zitadel_nextgen.app_revisions r
  ON r.project_id = a.project_id AND r.app_id = a.id`

	// A row is the newest revision when no sibling of the same app has a
	// greater created_at (ADR 063 §7); the unique index makes that total.
	newestAppRevision = `NOT EXISTS (SELECT 1 FROM zitadel_nextgen.app_revisions newer` +
		` WHERE newer.project_id = r.project_id` +
		` AND newer.app_id = r.app_id` +
		` AND newer.created_at > r.created_at)`

	createAppClientIDStmt = `INSERT INTO zitadel_nextgen.app_clients ` +
		`(project_id, id, app_id, slug, client_id) VALUES ($1, $2, $3, $4, $5) RETURNING created_at`

	appClientIDColumns = `SELECT project_id, id, app_id, slug, client_id, created_at FROM zitadel_nextgen.app_clients`

	listAppClientIDsStmt = appClientIDColumns + ` WHERE project_id = $1 AND app_id = $2 ORDER BY created_at, id`

	getAppClientIDByClientIDStmt = appClientIDColumns + ` WHERE project_id = $1 AND client_id = $2`

	createAppAPIIdentifierStmt = `INSERT INTO zitadel_nextgen.app_api_identifiers ` +
		`(project_id, identifier, app_id) VALUES ($1, $2, $3) RETURNING created_at`

	getAppAPIIdentifierStmt = `SELECT project_id, identifier, app_id, created_at ` +
		`FROM zitadel_nextgen.app_api_identifiers WHERE project_id = $1 AND identifier = $2`

	createAppClientSecretStmt = `INSERT INTO zitadel_nextgen.app_client_secrets ` +
		`(project_id, id, client_row_id, encoded_hash) VALUES ($1, $2, $3, $4) RETURNING created_at`

	listAppClientSecretsStmt = `SELECT project_id, id, client_row_id, encoded_hash, created_at ` +
		`FROM zitadel_nextgen.app_client_secrets WHERE project_id = $1 AND client_row_id = $2 ` +
		`ORDER BY created_at DESC, id DESC`

	updateAppClientSecretHashStmt = `UPDATE zitadel_nextgen.app_client_secrets ` +
		`SET encoded_hash = $3 WHERE project_id = $1 AND id = $2`
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
	return withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		if err := tx.QueryRow(ctx, createAppStmt,
			entity.ProjectID,
			entity.ID,
			entity.Slug,
			string(entity.Source),
		).Scan(&entity.CreatedAt); err != nil {
			return wrapError(err)
		}
		if err := tx.QueryRow(ctx, createAppRevisionStmt,
			entity.ProjectID,
			entity.RevisionID,
			entity.ID,
			entity.Document,
		).Scan(&entity.UpdatedAt); err != nil {
			return wrapError(err)
		}
		entity.CreatedAt, entity.UpdatedAt = entity.CreatedAt.UTC(), entity.UpdatedAt.UTC()
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindApp, entity.ProjectID, entity.ID))
	})
}

// ReviseApp implements [service.AppStatements].
func (s appStatements) ReviseApp(ctx context.Context, entity *domain.App) error {
	// A new id every time: the entity usually arrives from a get, and keeping
	// its revision id would rewrite that revision.
	revisionID, err := managedIDs.New(string(domain.PrefixAppRevision))
	if err != nil {
		return err
	}
	if err := s.client.QueryRow(ctx, reviseAppStmt,
		entity.ProjectID,
		revisionID,
		entity.ID,
		entity.Document,
	).Scan(&entity.UpdatedAt); err != nil {
		return appstore.ReviseNotFound(wrapError(err))
	}
	entity.UpdatedAt = entity.UpdatedAt.UTC()
	entity.RevisionID = revisionID
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
	entity, err := pgx.CollectExactlyOneRow(rows, scanApp)
	if err != nil {
		return nil, wrapError(err)
	}
	return entity, nil
}

// GetAppRevision implements [service.AppStatements].
func (s appStatements) GetAppRevision(ctx context.Context, projectID, revisionID string) (*domain.App, error) {
	// No newest-revision conjunct: a pinned read must reach a superseded row.
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
		// The alias `a`: authz guards the app row, on the revision list too.
		if err := compileList(ctx, &compiler, appQuery, opts, appstore.Schema, "a", "id", conjuncts...); err != nil {
			return nil, err
		}
		rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
		if err != nil {
			return nil, wrapError(err)
		}
		items, err := pgx.CollectRows(rows, scanApp)
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

func scanApp(row pgx.CollectableRow) (*domain.App, error) {
	entity := new(domain.App)
	var source string
	if err := row.Scan(
		&entity.ProjectID,
		&entity.ID,
		&entity.Slug,
		&source,
		&entity.RevisionID,
		&entity.Document,
		&entity.CreatedAt,
		&entity.UpdatedAt,
	); err != nil {
		return nil, err
	}
	entity.Source = domain.AppSource(source)
	entity.CreatedAt, entity.UpdatedAt = entity.CreatedAt.UTC(), entity.UpdatedAt.UTC()
	return entity, nil
}

// CreateAppClientID implements [service.AppStatements].
func (s appStatements) CreateAppClientID(ctx context.Context, entity *domain.AppClientID) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixAppClient); err != nil {
		return err
	}
	if entity.ClientID == "" {
		entity.ClientID = entity.ID
	}
	if err := s.client.QueryRow(ctx, createAppClientIDStmt,
		entity.ProjectID,
		entity.ID,
		entity.AppID,
		entity.Slug,
		entity.ClientID,
	).Scan(&entity.CreatedAt); err != nil {
		return wrapError(err)
	}
	entity.CreatedAt = entity.CreatedAt.UTC()
	return nil
}

// ListAppClientIDs implements [service.AppStatements].
func (s appStatements) ListAppClientIDs(ctx context.Context, projectID, appID string) ([]*domain.AppClientID, error) {
	rows, err := s.client.Query(ctx, listAppClientIDsStmt, projectID, appID)
	if err != nil {
		return nil, wrapError(err)
	}
	items, err := pgx.CollectRows(rows, scanAppClientID)
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
	entity, err := pgx.CollectExactlyOneRow(rows, scanAppClientID)
	if err != nil {
		return nil, wrapError(err)
	}
	return entity, nil
}

func scanAppClientID(row pgx.CollectableRow) (*domain.AppClientID, error) {
	entity := new(domain.AppClientID)
	if err := row.Scan(&entity.ProjectID, &entity.ID, &entity.AppID, &entity.Slug, &entity.ClientID, &entity.CreatedAt); err != nil {
		return nil, err
	}
	entity.CreatedAt = entity.CreatedAt.UTC()
	return entity, nil
}

// CreateAppAPIIdentifier implements [service.AppStatements].
func (s appStatements) CreateAppAPIIdentifier(ctx context.Context, entity *domain.AppAPIIdentifier) error {
	if err := s.client.QueryRow(ctx, createAppAPIIdentifierStmt,
		entity.ProjectID,
		entity.Identifier,
		entity.AppID,
	).Scan(&entity.CreatedAt); err != nil {
		return wrapError(err)
	}
	entity.CreatedAt = entity.CreatedAt.UTC()
	return nil
}

// GetAppAPIIdentifier implements [service.AppStatements].
func (s appStatements) GetAppAPIIdentifier(ctx context.Context, projectID, identifier string) (*domain.AppAPIIdentifier, error) {
	entity := new(domain.AppAPIIdentifier)
	if err := s.client.QueryRow(ctx, getAppAPIIdentifierStmt, projectID, identifier).
		Scan(&entity.ProjectID, &entity.Identifier, &entity.AppID, &entity.CreatedAt); err != nil {
		return nil, wrapError(err)
	}
	entity.CreatedAt = entity.CreatedAt.UTC()
	return entity, nil
}

// CreateAppClientSecret implements [service.AppStatements].
func (s appStatements) CreateAppClientSecret(ctx context.Context, entity *domain.AppClientSecret) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixAppClientSecret); err != nil {
		return err
	}
	if err := s.client.QueryRow(ctx, createAppClientSecretStmt,
		entity.ProjectID,
		entity.ID,
		entity.ClientRowID,
		entity.EncodedHash,
	).Scan(&entity.CreatedAt); err != nil {
		return wrapError(err)
	}
	entity.CreatedAt = entity.CreatedAt.UTC()
	return nil
}

// ListAppClientSecrets implements [service.AppStatements].
func (s appStatements) ListAppClientSecrets(ctx context.Context, projectID, clientRowID string) ([]*domain.AppClientSecret, error) {
	rows, err := s.client.Query(ctx, listAppClientSecretsStmt, projectID, clientRowID)
	if err != nil {
		return nil, wrapError(err)
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (*domain.AppClientSecret, error) {
		entity := new(domain.AppClientSecret)
		if err := row.Scan(&entity.ProjectID, &entity.ID, &entity.ClientRowID, &entity.EncodedHash, &entity.CreatedAt); err != nil {
			return nil, err
		}
		entity.CreatedAt = entity.CreatedAt.UTC()
		return entity, nil
	})
	if err != nil {
		return nil, wrapError(err)
	}
	return items, nil
}

// UpdateAppClientSecretHash implements [service.AppStatements].
func (s appStatements) UpdateAppClientSecretHash(ctx context.Context, projectID, id, encodedHash string) error {
	tag, err := s.client.Exec(ctx, updateAppClientSecretHashStmt, projectID, id, encodedHash)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

var _ service.AppStatements = (*appStatements)(nil)
