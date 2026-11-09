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
		`(project_id, id, slug) VALUES (@p1, @p2, @p3) THEN RETURN created_at`

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
		`(project_id, id, application_id, slug, client_id, secret_hash, created_at) VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7)`

	lockApplicationStmt = `SELECT id FROM applications WHERE project_id = @p1 AND id = @p2 FOR UPDATE`

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
		` WHERE project_id = @p1 AND application_id = @p2 ORDER BY slug`

	getApplicationClientByClientIDStmt = applicationClientColumns +
		` WHERE project_id = @p1 AND client_id = @p2`
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
	if err := ensureClientIDs(entity, clients); err != nil {
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
	if err := ensureClientIDs(entity, clients); err != nil {
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
	var compiler statementCompiler
	if err := compileRead(&compiler, applicationQuery, &database.ListOptions[domain.ApplicationField]{
		Filter: filter,
	}, application.Schema, newestApplicationRevision); err != nil {
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

// ensureClientIDs mints each client's primary key and gives a client without a
// client_id a copy of it (ADR 047 §5).
func ensureClientIDs(application *domain.Application, clients []*domain.ApplicationClient) error {
	for _, client := range clients {
		if err := ensureManagedID(&client.ID, domain.PrefixApplicationClient); err != nil {
			return err
		}
		if client.ClientID == "" {
			client.ClientID = client.ID
		}
		client.ProjectID, client.ApplicationID = application.ProjectID, application.ID
	}
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
			client.SecretHash,
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
	if err := row.Columns(&entity.ProjectID, &entity.ID, &entity.Slug, &entity.RevisionID, &documentJSON, &createdAt, &updatedAt); err != nil {
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
	if err := row.Columns(&client.ProjectID, &client.ApplicationID, &client.ID, &client.Slug, &client.ClientID, &client.SecretHash, &client.CreatedAt); err != nil {
		return nil, err
	}
	client.CreatedAt = client.CreatedAt.UTC()
	return &client, nil
}
