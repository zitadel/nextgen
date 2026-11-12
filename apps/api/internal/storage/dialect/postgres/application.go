package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/application"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/idpconnection"
)

const (
	createApplicationStmt = `INSERT INTO zitadel_nextgen.applications ` +
		`(project_id, id, slug) VALUES ($1, $2, $3) RETURNING created_at`

	// The first revision takes the column default now(), the application
	// row's transaction timestamp, so an application nobody revised has
	// CreatedAt == UpdatedAt.
	createApplicationRevisionStmt = `INSERT INTO zitadel_nextgen.application_revisions ` +
		`(project_id, id, application_id, document) VALUES ($1, $2, $3, $4) RETURNING created_at`

	// clock_timestamp() rather than now(), for the reason reviseIDPConnectionStmt
	// gives.
	reviseApplicationStmt = `INSERT INTO zitadel_nextgen.application_revisions ` +
		`(project_id, id, application_id, document, created_at) VALUES ($1, $2, $3, $4, clock_timestamp()) RETURNING created_at`

	// Binds the stamp of the revision that adds the client.
	createApplicationClientStmt = `INSERT INTO zitadel_nextgen.application_clients ` +
		`(project_id, id, application_id, slug, client_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)`

	lockApplicationStmt = `SELECT id FROM zitadel_nextgen.applications` +
		` WHERE project_id = $1 AND id = $2 FOR UPDATE`

	applicationQuery = `SELECT a.project_id, a.id, a.slug, r.id, r.document, a.created_at, r.created_at
FROM zitadel_nextgen.applications a
JOIN zitadel_nextgen.application_revisions r
  ON r.project_id = a.project_id AND r.application_id = a.id`

	// See newestIDPRevision.
	newestApplicationRevision = `NOT EXISTS (SELECT 1 FROM zitadel_nextgen.application_revisions newer` +
		` WHERE newer.project_id = r.project_id` +
		` AND newer.application_id = r.application_id` +
		` AND newer.created_at > r.created_at)`

	applicationClientColumns = `SELECT project_id, application_id, id, slug, client_id, created_at` +
		` FROM zitadel_nextgen.application_clients`

	listApplicationClientsStmt = applicationClientColumns +
		` WHERE project_id = $1 AND application_id = $2 ORDER BY slug`

	getApplicationClientByClientIDStmt = applicationClientColumns +
		` WHERE project_id = $1 AND client_id = $2`

	createApplicationClientSecretStmt = `INSERT INTO zitadel_nextgen.application_client_secrets ` +
		`(project_id, id, application_client_id, secret_hash) VALUES ($1, $2, $3, $4) RETURNING created_at`

	listApplicationClientSecretsStmt = `SELECT project_id, id, application_client_id, secret_hash, created_at` +
		` FROM zitadel_nextgen.application_client_secrets` +
		` WHERE project_id = $1 AND application_client_id = $2 ORDER BY created_at, id`
)

var _ service.ApplicationStatements = (*applicationStatements)(nil)

type applicationStatements struct{ statement }

func newApplicationStatements(client queryExecutor) applicationStatements {
	return applicationStatements{statement: statement{client: client}}
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
	document, err := application.FillClientIDs(entity.Document, clients...)
	if err != nil {
		return err
	}
	return withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		if err := tx.QueryRow(ctx, createApplicationStmt,
			entity.ProjectID,
			entity.ID,
			entity.Slug,
		).Scan(&entity.CreatedAt); err != nil {
			return wrapError(err)
		}
		if err := tx.QueryRow(ctx, createApplicationRevisionStmt,
			entity.ProjectID,
			entity.RevisionID,
			entity.ID,
			document,
		).Scan(&entity.UpdatedAt); err != nil {
			return wrapError(err)
		}
		// pgx scans timestamptz in Local; reads normalize to UTC.
		entity.CreatedAt, entity.UpdatedAt = entity.CreatedAt.UTC(), entity.UpdatedAt.UTC()
		entity.Document = document
		if err := insertApplicationClients(ctx, tx, clients, entity.UpdatedAt); err != nil {
			return err
		}
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
	return withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		stored, err := newApplicationStatements(tx).ListApplicationClients(ctx, entity.ProjectID, entity.ID)
		if err != nil {
			return err
		}
		document, err := application.FillClientIDs(entity.Document, append(stored, clients...)...)
		if err != nil {
			return err
		}
		var updatedAt time.Time
		if err := tx.QueryRow(ctx, reviseApplicationStmt,
			entity.ProjectID,
			revisionID,
			entity.ID,
			document,
		).Scan(&updatedAt); err != nil {
			return idpconnection.ReviseNotFound(wrapError(err))
		}
		updatedAt = updatedAt.UTC()
		if err := insertApplicationClients(ctx, tx, clients, updatedAt); err != nil {
			return err
		}
		// Set last: a failed client insert rolls the revision back, so the
		// entity keeps the revision that is still newest.
		entity.UpdatedAt, entity.RevisionID, entity.Document = updatedAt, revisionID, document
		return nil
	})
}

// LockApplication implements [service.ApplicationStatements].
func (s applicationStatements) LockApplication(ctx context.Context, projectID, id string) error {
	var locked string
	return wrapError(s.client.QueryRow(ctx, lockApplicationStmt, projectID, id).Scan(&locked))
}

// GetApplication implements [service.ApplicationStatements].
func (s applicationStatements) GetApplication(ctx context.Context, filter database.Filter[domain.ApplicationField]) (*domain.Application, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, applicationQuery, &database.ListOptions[domain.ApplicationField]{
		Filter: filter,
	}, application.Schema, newestApplicationRevision); err != nil {
		return nil, err
	}
	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	entity, err := pgx.CollectExactlyOneRow(rows, func(row pgx.CollectableRow) (*domain.Application, error) {
		entity := new(domain.Application)
		if err := row.Scan(&entity.ProjectID, &entity.ID, &entity.Slug, &entity.RevisionID, &entity.Document, &entity.CreatedAt, &entity.UpdatedAt); err != nil {
			return nil, err
		}
		entity.CreatedAt, entity.UpdatedAt = entity.CreatedAt.UTC(), entity.UpdatedAt.UTC()
		return entity, nil
	})
	if err != nil {
		return nil, wrapError(err)
	}
	return entity, nil
}

// ListApplicationClients implements [service.ApplicationStatements].
func (s applicationStatements) ListApplicationClients(ctx context.Context, projectID, applicationID string) ([]*domain.ApplicationClient, error) {
	rows, err := s.client.Query(ctx, listApplicationClientsStmt, projectID, applicationID)
	if err != nil {
		return nil, wrapError(err)
	}
	clients, err := pgx.CollectRows(rows, scanApplicationClient)
	if err != nil {
		return nil, wrapError(err)
	}
	return clients, nil
}

// GetApplicationClientByClientID implements [service.ApplicationStatements].
func (s applicationStatements) GetApplicationClientByClientID(ctx context.Context, projectID, clientID string) (*domain.ApplicationClient, error) {
	rows, err := s.client.Query(ctx, getApplicationClientByClientIDStmt, projectID, clientID)
	if err != nil {
		return nil, wrapError(err)
	}
	client, err := pgx.CollectExactlyOneRow(rows, scanApplicationClient)
	if err != nil {
		return nil, wrapError(err)
	}
	return client, nil
}

// CreateApplicationClientSecret implements [service.ApplicationStatements].
func (s applicationStatements) CreateApplicationClientSecret(ctx context.Context, secret *domain.ApplicationClientSecret) error {
	if err := ensureManagedID(&secret.ID, domain.PrefixApplicationClientSecret); err != nil {
		return err
	}
	if err := s.client.QueryRow(ctx, createApplicationClientSecretStmt,
		secret.ProjectID,
		secret.ID,
		secret.ApplicationClientID,
		secret.SecretHash,
	).Scan(&secret.CreatedAt); err != nil {
		return wrapError(err)
	}
	secret.CreatedAt = secret.CreatedAt.UTC()
	return nil
}

// ListApplicationClientSecrets implements [service.ApplicationStatements].
func (s applicationStatements) ListApplicationClientSecrets(ctx context.Context, projectID, applicationClientID string) ([]*domain.ApplicationClientSecret, error) {
	rows, err := s.client.Query(ctx, listApplicationClientSecretsStmt, projectID, applicationClientID)
	if err != nil {
		return nil, wrapError(err)
	}
	secrets, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (*domain.ApplicationClientSecret, error) {
		secret := new(domain.ApplicationClientSecret)
		if err := row.Scan(&secret.ProjectID, &secret.ID, &secret.ApplicationClientID, &secret.SecretHash, &secret.CreatedAt); err != nil {
			return nil, err
		}
		secret.CreatedAt = secret.CreatedAt.UTC()
		return secret, nil
	})
	if err != nil {
		return nil, wrapError(err)
	}
	return secrets, nil
}

func insertApplicationClients(ctx context.Context, tx queryExecutor, clients []*domain.ApplicationClient, createdAt time.Time) error {
	for _, client := range clients {
		if _, err := tx.Exec(ctx, createApplicationClientStmt,
			client.ProjectID,
			client.ID,
			client.ApplicationID,
			client.Slug,
			client.ClientID,
			createdAt,
		); err != nil {
			return wrapError(err)
		}
		client.CreatedAt = createdAt
	}
	return nil
}

func scanApplicationClient(row pgx.CollectableRow) (*domain.ApplicationClient, error) {
	client := new(domain.ApplicationClient)
	if err := row.Scan(&client.ProjectID, &client.ApplicationID, &client.ID, &client.Slug, &client.ClientID, &client.CreatedAt); err != nil {
		return nil, err
	}
	client.CreatedAt = client.CreatedAt.UTC()
	return client, nil
}
