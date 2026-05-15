package service

import (
	"context"
	"net/url"
	"time"

	"github.com/pkg/errors"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type SchemaService struct {
	pool           database.Pool
	schemaRepo     domain.JSONSchemaRepository
	schemaResolver domain.JSONSchemaResolver
}

func NewSchemaService(
	pool database.Pool,
	schemaRepo domain.JSONSchemaRepository,
	schemaResolver domain.JSONSchemaResolver,
) *SchemaService {
	return &SchemaService{
		pool:           pool,
		schemaRepo:     schemaRepo,
		schemaResolver: schemaResolver,
	}
}

func (s *SchemaService) CreateSchema(ctx context.Context, projectID string, teamID string, schemaID string, schema []byte) (*domain.JSONSchema, error) {
	tx, err := s.pool.Begin(ctx, nil)
	if err != nil {
		return nil, errors.New(`domain.ErrInternal(err).WitMessage("failed to start transaction")`)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	model := &domain.JSONSchema{
		ProjectID: projectID,
		URL:       schemaID,
		CreatedAt: time.Now().UTC(),
		Schema:    schema,
	}

	err = s.schemaRepo.Create(ctx, tx, model)
	if err != nil {
		return nil, errors.New("")
	}

	_, err = s.schemaResolver.Resolve(ctx, tx, projectID, schemaID, nil)
	if err != nil {
		return nil, err
	}

	err = tx.Commit(ctx)
	if err != nil {
		return nil, errors.New(`domain.ErrInternal(err).WitMessage("failed to commit transaction")`)
	}

	return model, nil
}

func (s *SchemaService) CreateSchemaByUrl(ctx context.Context, projectID string, teamID string, uri url.URL) (*domain.JSONSchema, error) {
	tx, err := s.pool.Begin(ctx, nil)
	if err != nil {
		return nil, errors.New(`domain.ErrInternal(err).WitMessage("failed to start transaction")`)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	_, err = s.schemaResolver.Resolve(ctx, tx, projectID, uri.String(), nil)
	if err != nil {
		return nil, err
	}

	err = tx.Commit(ctx)
	if err != nil {
		return nil, errors.New(`domain.ErrInternal(err).WitMessage("failed to commit transaction")`)
	}

	return s.schemaRepo.Get(ctx, s.pool, nil) // TODO(wim) figure out how to pass the ids and uri
}

func (s *SchemaService) GetSchema(ctx context.Context, projectID string, teamID string, id string) (*domain.JSONSchema, error) {
	return s.schemaRepo.Get(ctx, s.pool, nil) // TODO(wim) figure out how to pass the ids and uri
}
