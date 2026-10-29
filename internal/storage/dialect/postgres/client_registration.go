package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/appstore"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	createClientRegistrationStmt = `INSERT INTO zitadel_nextgen.client_registrations ` +
		`(project_id, id, metadata, secret_hash, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING created_at`

	clientRegistrationQuery = `SELECT project_id, id, metadata, secret_hash, created_at, expires_at ` +
		`FROM zitadel_nextgen.client_registrations`

	getClientRegistrationStmt = clientRegistrationQuery + ` WHERE project_id = $1 AND id = $2`

	deleteClientRegistrationStmt = `DELETE FROM zitadel_nextgen.client_registrations WHERE project_id = $1 AND id = $2`

	listExpiredClientRegistrationsStmt = `SELECT id FROM zitadel_nextgen.client_registrations ` +
		`WHERE project_id = $1 AND expires_at <= $2 ORDER BY expires_at, id LIMIT $3`

	extendClientRegistrationStmt = `UPDATE zitadel_nextgen.client_registrations ` +
		`SET expires_at = $3 WHERE project_id = $1 AND id = $2`
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
	var secretHash *string
	if entity.SecretHash != "" {
		secretHash = &entity.SecretHash
	}
	if err := s.client.QueryRow(ctx, createClientRegistrationStmt,
		entity.ProjectID,
		entity.ID,
		metadata,
		secretHash,
		entity.ExpiresAt,
	).Scan(&entity.CreatedAt); err != nil {
		return wrapError(err)
	}
	entity.CreatedAt, entity.ExpiresAt = entity.CreatedAt.UTC(), entity.ExpiresAt.UTC()
	return nil
}

// GetClientRegistration implements [service.ClientRegistrationStatements].
func (s clientRegistrationStatements) GetClientRegistration(ctx context.Context, projectID, id string) (*domain.ClientRegistration, error) {
	rows, err := s.client.Query(ctx, getClientRegistrationStmt, projectID, id)
	if err != nil {
		return nil, wrapError(err)
	}
	entity, err := pgx.CollectExactlyOneRow(rows, scanClientRegistration)
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
		items, err := pgx.CollectRows(rows, scanClientRegistration)
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
	tag, err := s.client.Exec(ctx, deleteClientRegistrationStmt, projectID, id)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

// ListExpiredClientRegistrations implements [service.ClientRegistrationStatements].
func (s clientRegistrationStatements) ListExpiredClientRegistrations(ctx context.Context, projectID string, now time.Time, limit int) ([]string, error) {
	rows, err := s.client.Query(ctx, listExpiredClientRegistrationsStmt, projectID, now, limit)
	if err != nil {
		return nil, wrapError(err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, wrapError(err)
	}
	return ids, nil
}

// ExtendClientRegistration implements [service.ClientRegistrationStatements].
func (s clientRegistrationStatements) ExtendClientRegistration(ctx context.Context, projectID, id string, expiresAt time.Time) error {
	tag, err := s.client.Exec(ctx, extendClientRegistrationStmt, projectID, id, expiresAt)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

func scanClientRegistration(row pgx.CollectableRow) (*domain.ClientRegistration, error) {
	var (
		entity     domain.ClientRegistration
		metadata   []byte
		secretHash *string
	)
	if err := row.Scan(&entity.ProjectID, &entity.ID, &metadata, &secretHash, &entity.CreatedAt, &entity.ExpiresAt); err != nil {
		return nil, err
	}
	m, err := appstore.DecodeClientRegistrationMetadata(metadata)
	if err != nil {
		return nil, err
	}
	entity.Metadata = m
	if secretHash != nil {
		entity.SecretHash = *secretHash
	}
	entity.CreatedAt, entity.ExpiresAt = entity.CreatedAt.UTC(), entity.ExpiresAt.UTC()
	return &entity, nil
}

var _ service.ClientRegistrationStatements = (*clientRegistrationStatements)(nil)
