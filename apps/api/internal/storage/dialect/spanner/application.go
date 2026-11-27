package spanner

import (
	"context"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/application"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/idpconnection"
)

const (
	createApplicationStmt = `INSERT INTO applications ` +
		`(project_id, id, slug, declared) VALUES (@p1, @p2, @p3, @p4) THEN RETURN created_at`

	// The default CURRENT_TIMESTAMP() is taken when this statement runs, after
	// the revise transaction read the application row, so revision order
	// follows lock order.
	createApplicationRevisionStmt = `INSERT INTO application_revisions ` +
		`(project_id, id, application_id, document) VALUES (@p1, @p2, @p3, @p4) THEN RETURN created_at`

	// Binds the application's stamp, for the reason
	// createFirstIDPConnectionRevisionStmt gives.
	createFirstApplicationRevisionStmt = `INSERT INTO application_revisions ` +
		`(project_id, id, application_id, document, created_at) VALUES (@p1, @p2, @p3, @p4, @p5)`

	// Binds the stamp of the revision that adds the client.
	createApplicationClientStmt = `INSERT INTO application_clients ` +
		`(project_id, id, application_id, slug, client_id, created_at) VALUES (@p1, @p2, @p3, @p4, @p5, @p6)`

	lockApplicationStmt = `SELECT id FROM applications WHERE project_id = @p1 AND id = @p2 FOR UPDATE`

	applicationQuery = `SELECT a.project_id, a.id, a.slug, a.declared, r.id, r.document, a.created_at, r.created_at
FROM applications a
JOIN application_revisions r
  ON r.project_id = a.project_id AND r.application_id = a.id`

	// See newestIDPRevision.
	newestApplicationRevision = `NOT EXISTS (SELECT 1 FROM application_revisions AS newer` +
		` WHERE newer.project_id = r.project_id` +
		` AND newer.application_id = r.application_id` +
		` AND newer.created_at > r.created_at)`

	applicationClientColumns = `SELECT project_id, application_id, id, slug, client_id, created_at` +
		` FROM application_clients`

	listApplicationClientsStmt = applicationClientColumns +
		` WHERE project_id = @p1 AND application_id = @p2 ORDER BY slug`

	getApplicationClientByClientIDStmt = applicationClientColumns +
		` WHERE project_id = @p1 AND client_id = @p2`

	createApplicationClientSecretStmt = `INSERT INTO application_client_secrets ` +
		`(project_id, id, application_client_id, secret_hash) VALUES (@p1, @p2, @p3, @p4) THEN RETURN created_at`

	listApplicationClientSecretsStmt = `SELECT project_id, id, application_client_id, secret_hash, created_at` +
		` FROM application_client_secrets` +
		` WHERE project_id = @p1 AND application_client_id = @p2 ORDER BY created_at, id`

	deleteApplicationClientSecretsStmt = `DELETE FROM application_client_secrets WHERE project_id = @p1 AND application_client_id = @p2`

	applicationIdempotencyKeyColumns    = `project_id, key_hash, request_hash, application_id, created, client_ids, created_at, expires_at`
	getApplicationIdempotencyKeyStmt    = `SELECT ` + applicationIdempotencyKeyColumns + ` FROM application_idempotency_keys WHERE project_id = @p1 AND key_hash = @p2 AND expires_at > @p3`
	deleteApplicationIdempotencyKeyStmt = `DELETE FROM application_idempotency_keys WHERE project_id = @p1 AND key_hash = @p2 AND expires_at <= @p3`
	createApplicationIdempotencyKeyStmt = `INSERT INTO application_idempotency_keys (` + applicationIdempotencyKeyColumns + `)` +
		` VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8)`

	getApplicationSecretVariableStmt = `SELECT project_id, name, application_client_id, created_at` +
		` FROM application_secret_variables WHERE project_id = @p1 AND name = @p2`

	createApplicationSecretVariableStmt = `INSERT INTO application_secret_variables ` +
		`(project_id, name, application_client_id) VALUES (@p1, @p2, @p3) THEN RETURN created_at`
)

var _ service.ApplicationStatements = (*applicationStatements)(nil)

type applicationStatements struct{ statement }

func newApplicationStatements(db queryExecutor) applicationStatements {
	return applicationStatements{statement: statement{db: db}}
}

// CreateApplication implements [service.ApplicationStatements].
func (s applicationStatements) CreateApplication(ctx context.Context, entity *domain.Application, clients []*domain.ApplicationClient) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixApplication); err != nil {
		return err
	}
	if err := ensureManagedID(&entity.RevisionID, domain.PrefixApplicationRevision); err != nil {
		return err
	}
	if err := application.EnsureClientIDs(entity, clients, ensureManagedID); err != nil {
		return err
	}
	filled, err := application.FillClientIDs(entity.Document, clients...)
	if err != nil {
		return err
	}
	document, err := encodeNullJSON(filled)
	if err != nil {
		return wrapError(err)
	}
	return withTransaction(ctx, s.db, func(ctx context.Context, tx queryExecutor) error {
		// A retry replays this callback, so the stamp stays local.
		var createdAt time.Time
		stmt := buildStatement(createApplicationStmt,
			entity.ProjectID,
			entity.ID,
			entity.Slug,
			entity.IsDeclared,
		).statement()
		if err := tx.Write(ctx, stmt, scanReturnedTimestamp(&createdAt)); err != nil {
			return err
		}
		revision := buildStatement(createFirstApplicationRevisionStmt,
			entity.ProjectID,
			entity.RevisionID,
			entity.ID,
			document,
			createdAt,
		).statement()
		if _, err := tx.Update(ctx, revision); err != nil {
			return err
		}
		if err := insertApplicationClients(ctx, tx, clients, createdAt); err != nil {
			return err
		}
		entity.CreatedAt, entity.UpdatedAt, entity.Document = createdAt, createdAt, filled
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindApplication, entity.ProjectID, entity.ID))
	})
}

// ReviseApplication implements [service.ApplicationStatements].
func (s applicationStatements) ReviseApplication(ctx context.Context, entity *domain.Application, clients []*domain.ApplicationClient) error {
	// A new id every time, not ensureManagedID: the entity usually arrives from
	// a get, and keeping its revision id would rewrite that revision.
	revisionID, err := managedIDs.New(string(domain.PrefixApplicationRevision))
	if err != nil {
		return err
	}
	if err := application.EnsureClientIDs(entity, clients, ensureManagedID); err != nil {
		return err
	}
	return withTransaction(ctx, s.db, func(ctx context.Context, tx queryExecutor) error {
		stored, err := newApplicationStatements(tx).ListApplicationClients(ctx, entity.ProjectID, entity.ID)
		if err != nil {
			return err
		}
		filled, err := application.FillClientIDs(entity.Document, append(stored, clients...)...)
		if err != nil {
			return err
		}
		document, err := encodeNullJSON(filled)
		if err != nil {
			return wrapError(err)
		}
		var updatedAt time.Time
		revision := buildStatement(createApplicationRevisionStmt,
			entity.ProjectID,
			revisionID,
			entity.ID,
			document,
		).statement()
		if err := tx.Write(ctx, revision, scanReturnedTimestamp(&updatedAt)); err != nil {
			return idpconnection.ReviseNotFound(err)
		}
		if err := insertApplicationClients(ctx, tx, clients, updatedAt); err != nil {
			return err
		}
		entity.UpdatedAt, entity.RevisionID, entity.Document = updatedAt, revisionID, filled
		return nil
	})
}

// LockApplication implements [service.ApplicationStatements].
//
// FOR UPDATE takes an exclusive lock; see LockIDPConnection.
func (s applicationStatements) LockApplication(ctx context.Context, projectID, id string) error {
	return s.db.Query(ctx, buildStatement(lockApplicationStmt, projectID, id).statement(), func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(*spanner.Row) (struct{}, error) { return struct{}{}, nil })
		return err
	})
}

// GetApplication implements [service.ApplicationStatements].
func (s applicationStatements) GetApplication(ctx context.Context, filter database.Filter[domain.ApplicationField]) (*domain.Application, error) {
	return s.getOne(ctx, filter, newestApplicationRevision)
}

// GetApplicationRevision implements [service.ApplicationStatements].
func (s applicationStatements) GetApplicationRevision(ctx context.Context, projectID, revisionID string) (*domain.Application, error) {
	// No newest-revision conjunct: a pinned read must reach a superseded row.
	return s.getOne(ctx, database.And(
		database.Equal(database.Col(domain.ApplicationFieldProjectID), projectID),
		database.Equal(database.Col(domain.ApplicationFieldRevisionID), revisionID),
	))
}

func (s applicationStatements) getOne(ctx context.Context, filter database.Filter[domain.ApplicationField], conjuncts ...string) (*domain.Application, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, applicationQuery, &database.ListOptions[domain.ApplicationField]{
		Filter: filter,
	}, application.Schema, conjuncts...); err != nil {
		return nil, err
	}
	var entity *domain.Application
	if err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		entity, err = collectOneRow(iter, scanApplication)
		return err
	}); err != nil {
		return nil, err
	}
	return entity, nil
}

// ListApplicationRevisions implements [service.ApplicationStatements].
func (s applicationStatements) ListApplicationRevisions(ctx context.Context, projectID, applicationID string, limit uint32) ([]*domain.Application, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, applicationQuery, application.RevisionsListOptions(projectID, applicationID, limit), application.Schema); err != nil {
		return nil, err
	}
	var revisions []*domain.Application
	if err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		revisions, err = collectRows(iter, scanApplication)
		return err
	}); err != nil {
		return nil, err
	}
	return revisions, nil
}

// ListApplicationClients implements [service.ApplicationStatements].
func (s applicationStatements) ListApplicationClients(ctx context.Context, projectID, applicationID string) ([]*domain.ApplicationClient, error) {
	var clients []*domain.ApplicationClient
	if err := s.db.Query(ctx, buildStatement(listApplicationClientsStmt, projectID, applicationID).statement(), func(iter *spanner.RowIterator) error {
		var err error
		clients, err = collectRows(iter, scanApplicationClient)
		return err
	}); err != nil {
		return nil, err
	}
	return clients, nil
}

// GetApplicationClientByClientID implements [service.ApplicationStatements].
func (s applicationStatements) GetApplicationClientByClientID(ctx context.Context, projectID, clientID string) (*domain.ApplicationClient, error) {
	var client *domain.ApplicationClient
	if err := s.db.Query(ctx, buildStatement(getApplicationClientByClientIDStmt, projectID, clientID).statement(), func(iter *spanner.RowIterator) error {
		var err error
		client, err = collectOneRow(iter, scanApplicationClient)
		return err
	}); err != nil {
		return nil, err
	}
	return client, nil
}

// CreateApplicationClientSecret implements [service.ApplicationStatements].
func (s applicationStatements) CreateApplicationClientSecret(ctx context.Context, secret *domain.ApplicationClientSecret) error {
	if err := ensureManagedID(&secret.ID, domain.PrefixApplicationClientSecret); err != nil {
		return err
	}
	stmt := buildStatement(createApplicationClientSecretStmt,
		secret.ProjectID,
		secret.ID,
		secret.ApplicationClientID,
		secret.SecretHash,
	).statement()
	if err := s.db.Write(ctx, stmt, scanReturnedTimestamp(&secret.CreatedAt)); err != nil {
		return err
	}
	secret.CreatedAt = secret.CreatedAt.UTC()
	return nil
}

// ListApplicationClientSecrets implements [service.ApplicationStatements].
func (s applicationStatements) ListApplicationClientSecrets(ctx context.Context, projectID, applicationClientID string) ([]*domain.ApplicationClientSecret, error) {
	var secrets []*domain.ApplicationClientSecret
	if err := s.db.Query(ctx, buildStatement(listApplicationClientSecretsStmt, projectID, applicationClientID).statement(), func(iter *spanner.RowIterator) error {
		var err error
		secrets, err = collectRows(iter, func(row *spanner.Row) (*domain.ApplicationClientSecret, error) {
			var secret domain.ApplicationClientSecret
			if err := row.Columns(&secret.ProjectID, &secret.ID, &secret.ApplicationClientID, &secret.SecretHash, &secret.CreatedAt); err != nil {
				return nil, err
			}
			secret.CreatedAt = secret.CreatedAt.UTC()
			return &secret, nil
		})
		return err
	}); err != nil {
		return nil, err
	}
	return secrets, nil
}

// DeleteApplicationClientSecrets implements [service.ApplicationStatements].
func (s applicationStatements) DeleteApplicationClientSecrets(ctx context.Context, projectID, applicationClientID string) error {
	_, err := s.db.Update(ctx, buildStatement(deleteApplicationClientSecretsStmt, projectID, applicationClientID).statement())
	return err
}

// GetApplicationIdempotencyKey implements [service.ApplicationStatements].
func (s applicationStatements) GetApplicationIdempotencyKey(ctx context.Context, projectID, keyHash string, now time.Time) (*domain.ApplicationIdempotencyKey, error) {
	var key *domain.ApplicationIdempotencyKey
	if err := s.db.Query(ctx, buildStatement(getApplicationIdempotencyKeyStmt, projectID, keyHash, now).statement(), func(iter *spanner.RowIterator) error {
		var err error
		key, err = collectOneRow(iter, func(row *spanner.Row) (*domain.ApplicationIdempotencyKey, error) {
			var key domain.ApplicationIdempotencyKey
			if err := row.Columns(&key.ProjectID, &key.KeyHash, &key.RequestHash, &key.ApplicationID, &key.Created, &key.ClientIDs, &key.CreatedAt, &key.ExpiresAt); err != nil {
				return nil, err
			}
			key.CreatedAt, key.ExpiresAt = key.CreatedAt.UTC(), key.ExpiresAt.UTC()
			return &key, nil
		})
		return err
	}); err != nil {
		return nil, err
	}
	return key, nil
}

// CreateApplicationIdempotencyKey implements [service.ApplicationStatements].
func (s applicationStatements) CreateApplicationIdempotencyKey(ctx context.Context, key *domain.ApplicationIdempotencyKey) error {
	// A nil slice is written as NULL, which the column refuses.
	clientIDs := key.ClientIDs
	if clientIDs == nil {
		clientIDs = []string{}
	}
	return withTransaction(ctx, s.db, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Update(ctx, buildStatement(deleteApplicationIdempotencyKeyStmt, key.ProjectID, key.KeyHash, key.CreatedAt).statement()); err != nil {
			return err
		}
		_, err := tx.Update(ctx, buildStatement(createApplicationIdempotencyKeyStmt,
			key.ProjectID, key.KeyHash, key.RequestHash, key.ApplicationID, key.Created, clientIDs, key.CreatedAt, key.ExpiresAt).statement())
		return err
	})
}

// GetApplicationSecretVariable implements [service.ApplicationStatements].
func (s applicationStatements) GetApplicationSecretVariable(ctx context.Context, projectID, name string) (*domain.ApplicationSecretVariable, error) {
	var variable *domain.ApplicationSecretVariable
	if err := s.db.Query(ctx, buildStatement(getApplicationSecretVariableStmt, projectID, name).statement(), func(iter *spanner.RowIterator) error {
		var err error
		variable, err = collectOneRow(iter, func(row *spanner.Row) (*domain.ApplicationSecretVariable, error) {
			var variable domain.ApplicationSecretVariable
			if err := row.Columns(&variable.ProjectID, &variable.Name, &variable.ApplicationClientID, &variable.CreatedAt); err != nil {
				return nil, err
			}
			variable.CreatedAt = variable.CreatedAt.UTC()
			return &variable, nil
		})
		return err
	}); err != nil {
		return nil, err
	}
	return variable, nil
}

// CreateApplicationSecretVariable implements [service.ApplicationStatements].
func (s applicationStatements) CreateApplicationSecretVariable(ctx context.Context, variable *domain.ApplicationSecretVariable) error {
	stmt := buildStatement(createApplicationSecretVariableStmt,
		variable.ProjectID,
		variable.Name,
		variable.ApplicationClientID,
	).statement()
	if err := s.db.Write(ctx, stmt, scanReturnedTimestamp(&variable.CreatedAt)); err != nil {
		return err
	}
	variable.CreatedAt = variable.CreatedAt.UTC()
	return nil
}

func insertApplicationClients(ctx context.Context, tx queryExecutor, clients []*domain.ApplicationClient, createdAt time.Time) error {
	for _, client := range clients {
		stmt := buildStatement(createApplicationClientStmt,
			client.ProjectID,
			client.ID,
			client.ApplicationID,
			client.Slug,
			client.ClientID,
			createdAt,
		).statement()
		if _, err := tx.Update(ctx, stmt); err != nil {
			return err
		}
		client.CreatedAt = createdAt
	}
	return nil
}

func scanApplication(row *spanner.Row) (*domain.Application, error) {
	var (
		entity               domain.Application
		documentJSON         spanner.NullJSON
		createdAt, updatedAt time.Time
	)
	if err := row.Columns(&entity.ProjectID, &entity.ID, &entity.Slug, &entity.IsDeclared, &entity.RevisionID, &documentJSON, &createdAt, &updatedAt); err != nil {
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

func scanApplicationClient(row *spanner.Row) (*domain.ApplicationClient, error) {
	var client domain.ApplicationClient
	if err := row.Columns(&client.ProjectID, &client.ApplicationID, &client.ID, &client.Slug, &client.ClientID, &client.CreatedAt); err != nil {
		return nil, err
	}
	client.CreatedAt = client.CreatedAt.UTC()
	return &client, nil
}
