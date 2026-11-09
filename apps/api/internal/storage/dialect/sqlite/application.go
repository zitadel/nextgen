package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/application"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/idpconnection"
)

const (
	createApplicationStmt = `INSERT INTO applications ` +
		`(project_id, id, slug, created_at) VALUES (?, ?, ?, ?)`

	createApplicationRevisionStmt = `INSERT INTO application_revisions ` +
		`(project_id, id, application_id, document, created_at) VALUES (?, ?, ?, ?, ?)`

	createApplicationClientStmt = `INSERT INTO application_clients ` +
		`(project_id, id, application_id, slug, client_id, secret_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`

	// No FOR UPDATE; see lockIDPConnectionStmt.
	lockApplicationStmt = `SELECT id FROM applications WHERE project_id = ? AND id = ?`

	applicationQuery = `SELECT a.project_id, a.id, a.slug, r.id, r.document, a.created_at, r.created_at
FROM applications a
JOIN application_revisions r
  ON r.project_id = a.project_id AND r.application_id = a.id`

	// See newestIDPRevision.
	newestApplicationRevision = `NOT EXISTS (SELECT 1 FROM application_revisions AS newer` +
		` WHERE newer.project_id = r.project_id` +
		` AND newer.application_id = r.application_id` +
		` AND newer.created_at > r.created_at)`

	applicationClientColumns = `SELECT project_id, application_id, id, slug, client_id, secret_hash, created_at` +
		` FROM application_clients`

	listApplicationClientsStmt = applicationClientColumns +
		` WHERE project_id = ? AND application_id = ? ORDER BY slug`

	getApplicationClientByClientIDStmt = applicationClientColumns +
		` WHERE project_id = ? AND client_id = ?`
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
	// One stamp for every row, so an application nobody revised reports
	// CreatedAt == UpdatedAt.
	now := nowUnixNano()
	return withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Exec(ctx, createApplicationStmt,
			entity.ProjectID,
			entity.ID,
			entity.Slug,
			now,
		); err != nil {
			return wrapError(err)
		}
		if _, err := tx.Exec(ctx, createApplicationRevisionStmt,
			entity.ProjectID,
			entity.RevisionID,
			entity.ID,
			string(document),
			now,
		); err != nil {
			return wrapError(err)
		}
		if err := insertApplicationClients(ctx, tx, clients, now); err != nil {
			return err
		}
		entity.CreatedAt, entity.UpdatedAt = timeFromUnixNano(now), timeFromUnixNano(now)
		entity.Document = document
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
		// Stamped inside BEGIN IMMEDIATE, so revision order follows transaction
		// order.
		now := nowUnixNano()
		stored, err := newApplicationStatements(tx).ListApplicationClients(ctx, entity.ProjectID, entity.ID)
		if err != nil {
			return err
		}
		document, err := application.FillClientIDs(entity.Document, append(stored, clients...)...)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, createApplicationRevisionStmt,
			entity.ProjectID,
			revisionID,
			entity.ID,
			string(document),
			now,
		); err != nil {
			return idpconnection.ReviseNotFound(wrapError(err))
		}
		if err := insertApplicationClients(ctx, tx, clients, now); err != nil {
			return err
		}
		// Set last; see the postgres dialect.
		entity.RevisionID, entity.UpdatedAt, entity.Document = revisionID, timeFromUnixNano(now), document
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
	defer rows.Close()
	entity, err := collectExactlyOneRow(rows, scanApplication)
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
	defer rows.Close()
	clients, err := collectRows(rows, scanApplicationClient)
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
	defer rows.Close()
	client, err := collectExactlyOneRow(rows, scanApplicationClient)
	if err != nil {
		return nil, wrapError(err)
	}
	return client, nil
}

func insertApplicationClients(ctx context.Context, tx queryExecutor, clients []*domain.ApplicationClient, now int64) error {
	for _, client := range clients {
		if _, err := tx.Exec(ctx, createApplicationClientStmt,
			client.ProjectID,
			client.ID,
			client.ApplicationID,
			client.Slug,
			client.ClientID,
			client.SecretHash,
			now,
		); err != nil {
			return wrapError(err)
		}
		client.CreatedAt = timeFromUnixNano(now)
	}
	return nil
}

func scanApplication(rows *sql.Rows) (*domain.Application, error) {
	var (
		entity                   domain.Application
		document                 string
		createdNano, updatedNano int64
	)
	if err := rows.Scan(&entity.ProjectID, &entity.ID, &entity.Slug, &entity.RevisionID, &document, &createdNano, &updatedNano); err != nil {
		return nil, err
	}
	entity.Document = []byte(document)
	entity.CreatedAt, entity.UpdatedAt = timeFromUnixNano(createdNano), timeFromUnixNano(updatedNano)
	return &entity, nil
}

func scanApplicationClient(rows *sql.Rows) (*domain.ApplicationClient, error) {
	var (
		client      domain.ApplicationClient
		createdNano int64
	)
	if err := rows.Scan(&client.ProjectID, &client.ApplicationID, &client.ID, &client.Slug, &client.ClientID, &client.SecretHash, &createdNano); err != nil {
		return nil, err
	}
	client.CreatedAt = timeFromUnixNano(createdNano)
	return &client, nil
}
