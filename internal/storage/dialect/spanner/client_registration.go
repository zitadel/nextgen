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
	createClientRegistrationStmt = `INSERT INTO client_registrations ` +
		`(project_id, id, metadata, secret_hash, expires_at) VALUES (@p1, @p2, @p3, @p4, @p5) THEN RETURN created_at`

	clientRegistrationQuery = `SELECT project_id, id, metadata, secret_hash, created_at, expires_at ` +
		`FROM client_registrations`

	getClientRegistrationStmt = clientRegistrationQuery + ` WHERE project_id = @p1 AND id = @p2`

	deleteClientRegistrationStmt = `DELETE FROM client_registrations WHERE project_id = @p1 AND id = @p2`

	listExpiredClientRegistrationsStmt = `SELECT id FROM client_registrations ` +
		`WHERE project_id = @p1 AND expires_at <= @p2 ORDER BY expires_at, id LIMIT @p3`

	extendClientRegistrationStmt = `UPDATE client_registrations SET expires_at = @p3 WHERE project_id = @p1 AND id = @p2`
)

type clientRegistrationStatements struct{ statement }

func newClientRegistrationStatements(db queryExecutor) clientRegistrationStatements {
	return clientRegistrationStatements{statement: statement{db: db}}
}

// CreateClientRegistration implements [service.ClientRegistrationStatements].
func (s clientRegistrationStatements) CreateClientRegistration(ctx context.Context, entity *domain.ClientRegistration) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixClientRegistration); err != nil {
		return err
	}
	raw, err := appstore.EncodeClientRegistrationMetadata(entity.Metadata)
	if err != nil {
		return err
	}
	metadata, err := encodeNullJSON(raw)
	if err != nil {
		return err
	}
	secretHash := spanner.NullString{StringVal: entity.SecretHash, Valid: entity.SecretHash != ""}
	stmt := buildStatement(createClientRegistrationStmt,
		entity.ProjectID,
		entity.ID,
		metadata,
		secretHash,
		entity.ExpiresAt,
	).statement()
	if err := s.db.Write(ctx, stmt, scanReturnedTimestamp(&entity.CreatedAt)); err != nil {
		return err
	}
	entity.ExpiresAt = entity.ExpiresAt.UTC()
	return nil
}

// GetClientRegistration implements [service.ClientRegistrationStatements].
func (s clientRegistrationStatements) GetClientRegistration(ctx context.Context, projectID, id string) (*domain.ClientRegistration, error) {
	var entity *domain.ClientRegistration
	err := s.db.Query(ctx, buildStatement(getClientRegistrationStmt, projectID, id).statement(), func(iter *spanner.RowIterator) error {
		var err error
		entity, err = collectOneRow(iter, scanClientRegistration)
		return err
	})
	return entity, err
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
		var items []*domain.ClientRegistration
		if err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
			var err error
			items, err = collectRows(iter, scanClientRegistration)
			return err
		}); err != nil {
			return nil, err
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
	n, err := s.db.Update(ctx, buildStatement(deleteClientRegistrationStmt, projectID, id).statement())
	if err != nil {
		return wrapError(err)
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

// ListExpiredClientRegistrations implements [service.ClientRegistrationStatements].
func (s clientRegistrationStatements) ListExpiredClientRegistrations(ctx context.Context, projectID string, now time.Time, limit int) ([]string, error) {
	var ids []string
	err := s.db.Query(ctx, buildStatement(listExpiredClientRegistrationsStmt, projectID, now, int64(limit)).statement(), func(iter *spanner.RowIterator) error {
		var err error
		ids, err = collectRows(iter, func(row *spanner.Row) (string, error) {
			var id string
			err := row.Columns(&id)
			return id, err
		})
		return err
	})
	return ids, err
}

// ExtendClientRegistration implements [service.ClientRegistrationStatements].
func (s clientRegistrationStatements) ExtendClientRegistration(ctx context.Context, projectID, id string, expiresAt time.Time) error {
	n, err := s.db.Update(ctx, buildStatement(extendClientRegistrationStmt, projectID, id, expiresAt).statement())
	if err != nil {
		return wrapError(err)
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

func scanClientRegistration(row *spanner.Row) (*domain.ClientRegistration, error) {
	var (
		entity     domain.ClientRegistration
		metadata   spanner.NullJSON
		secretHash spanner.NullString
	)
	if err := row.Columns(&entity.ProjectID, &entity.ID, &metadata, &secretHash, &entity.CreatedAt, &entity.ExpiresAt); err != nil {
		return nil, err
	}
	raw, err := decodeNullJSON(metadata)
	if err != nil {
		return nil, wrapError(err)
	}
	m, err := appstore.DecodeClientRegistrationMetadata(raw)
	if err != nil {
		return nil, wrapError(err)
	}
	entity.Metadata = m
	entity.SecretHash = secretHash.StringVal
	entity.CreatedAt, entity.ExpiresAt = entity.CreatedAt.UTC(), entity.ExpiresAt.UTC()
	return &entity, nil
}

var _ service.ClientRegistrationStatements = (*clientRegistrationStatements)(nil)
