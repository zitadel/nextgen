package service

import (
	"context"
	"errors"
	"net/url"
	"time"

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
		return nil, err
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

	strUri := uri.String()
	_, err = s.schemaResolver.Resolve(ctx, tx, projectID, strUri, nil)
	if err != nil {
		return nil, err
	}

	err = tx.Commit(ctx)
	if err != nil {
		return nil, errors.New(`domain.ErrInternal(err).WitMessage("failed to commit transaction")`)
	}

	// TODO(wim): Since repository does not yet have a get by id, we need to use the condition. This will change in the future
	return s.schemaRepo.Get(ctx, s.pool, database.WithCondition(s.schemaRepo.PrimaryKeyCondition(projectID, strUri)))
}

func (s *SchemaService) GetSchema(ctx context.Context, projectID string, teamID string, id string) (*domain.JSONSchema, error) {
	// TODO(wim): Since repository does not yet have a get by id, we need to use the condition. This will change in the future
	return s.schemaRepo.Get(ctx, s.pool, database.WithCondition(s.schemaRepo.PrimaryKeyCondition(projectID, id)))
}
