package sqlite

import (
	"context"
	"database/sql"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/appstore"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	createClientRegistrationStmt = `INSERT INTO client_registrations ` +
		`(project_id, id, metadata, secret_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`

	clientRegistrationQuery = `SELECT project_id, id, metadata, secret_hash, created_at, expires_at ` +
		`FROM client_registrations`

	getClientRegistrationStmt = clientRegistrationQuery + ` WHERE project_id = ? AND id = ?`

	deleteClientRegistrationStmt = `DELETE FROM client_registrations WHERE project_id = ? AND id = ?`

	listExpiredClientRegistrationsStmt = `SELECT id FROM client_registrations ` +
		`WHERE project_id = ? AND expires_at <= ? ORDER BY expires_at, id LIMIT ?`

	extendClientRegistrationStmt = `UPDATE client_registrations SET expires_at = ? WHERE project_id = ? AND id = ?`
)

type clientRegistrationStatements struct{ statement }

func newClientRegistrationStatements(client queryExecutor) clientRegistrationStatements {
	return clientRegistrationStatements{statement: statement{client: client}}
}

// CreateClientRegistration implements [service.ClientRegistrationStatements].
func (s clientRegistrationStatements) CreateClientRegistration(ctx context.Context, entity *domain.ClientRegistration) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixClientRegistration); err != nil {
		return err
	}
	metadata, err := appstore.EncodeClientRegistrationMetadata(entity.Metadata)
	if err != nil {
		return err
	}
	var secretHash sql.NullString
	if entity.SecretHash != "" {
		secretHash = sql.NullString{String: entity.SecretHash, Valid: true}
	}
	now := nowUnixNano()
	if _, err := s.client.Exec(ctx, createClientRegistrationStmt,
		entity.ProjectID,
		entity.ID,
		string(metadata),
		secretHash,
		now,
		entity.ExpiresAt.UnixNano(),
	); err != nil {
		return wrapError(err)
	}
	entity.CreatedAt, entity.ExpiresAt = timeFromUnixNano(now), timeFromUnixNano(entity.ExpiresAt.UnixNano())
	return nil
}

// GetClientRegistration implements [service.ClientRegistrationStatements].
func (s clientRegistrationStatements) GetClientRegistration(ctx context.Context, projectID, id string) (*domain.ClientRegistration, error) {
	rows, err := s.client.Query(ctx, getClientRegistrationStmt, projectID, id)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	entity, err := collectExactlyOneRow(rows, scanClientRegistration)
	if err != nil {
		return nil, wrapError(err)
	}
	return entity, nil
}

// ListClientRegistrations implements [service.ClientRegistrationStatements].
func (s clientRegistrationStatements) ListClientRegistrations(ctx context.Context, opts *database.ListOptions[domain.ClientRegistrationField]) (*database.ListResult[*domain.ClientRegistration], error) {
	opts = appstore.EnsureClientRegistrationListOptions(opts)
	items, nextCursor, err := pagination.Page(opts.Pagination, appstore.ClientRegistrationSchema, func(limit uint32) ([]*domain.ClientRegistration, error) {
		opts := opts.WithLimit(limit)
		var compiler statementCompiler
		// No per-row authz: a registration belongs to the project, and the
		// handler checked the caller's access to it.
		if err := compileList(ctx, &compiler, clientRegistrationQuery, opts, appstore.ClientRegistrationSchema, "", ""); err != nil {
			return nil, err
		}
		rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
		if err != nil {
			return nil, wrapError(err)
		}
		defer rows.Close()
		items, err := collectRows(rows, scanClientRegistration)
		if err != nil {
			return nil, wrapError(err)
		}
		return items, nil
	})
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []*domain.ClientRegistration{}
	}
	return &database.ListResult[*domain.ClientRegistration]{Items: items, NextCursor: nextCursor}, nil
}

// DeleteClientRegistration implements [service.ClientRegistrationStatements].
func (s clientRegistrationStatements) DeleteClientRegistration(ctx context.Context, projectID, id string) error {
	n, err := execAffected(ctx, s.client, deleteClientRegistrationStmt, projectID, id)
	if err != nil {
		return err
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

// ListExpiredClientRegistrations implements [service.ClientRegistrationStatements].
func (s clientRegistrationStatements) ListExpiredClientRegistrations(ctx context.Context, projectID string, now time.Time, limit int) ([]string, error) {
	rows, err := s.client.Query(ctx, listExpiredClientRegistrationsStmt, projectID, now.UnixNano(), limit)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	ids, err := collectRows(rows, func(rows *sql.Rows) (string, error) {
		var id string
		err := rows.Scan(&id)
		return id, err
	})
	if err != nil {
		return nil, wrapError(err)
	}
	return ids, nil
}

// ExtendClientRegistration implements [service.ClientRegistrationStatements].
func (s clientRegistrationStatements) ExtendClientRegistration(ctx context.Context, projectID, id string, expiresAt time.Time) error {
	n, err := execAffected(ctx, s.client, extendClientRegistrationStmt, expiresAt.UnixNano(), projectID, id)
	if err != nil {
		return err
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

func scanClientRegistration(rows *sql.Rows) (*domain.ClientRegistration, error) {
	var (
		entity                   domain.ClientRegistration
		metadata                 string
		secretHash               sql.NullString
		createdNano, expiresNano int64
	)
	if err := rows.Scan(&entity.ProjectID, &entity.ID, &metadata, &secretHash, &createdNano, &expiresNano); err != nil {
		return nil, err
	}
	m, err := appstore.DecodeClientRegistrationMetadata([]byte(metadata))
	if err != nil {
		return nil, err
	}
	entity.Metadata = m
	entity.SecretHash = secretHash.String
	entity.CreatedAt, entity.ExpiresAt = timeFromUnixNano(createdNano), timeFromUnixNano(expiresNano)
	return &entity, nil
}

var _ service.ClientRegistrationStatements = (*clientRegistrationStatements)(nil)
