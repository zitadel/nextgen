package service

import (
	"context"
	"errors"
	"net/url"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ---- Input types -------------------------------------------------------------

type CreateSchemaInput struct {
	ProjectID string
	TeamID    string
	SchemaID  string
	Schema    []byte
}

type CreateSchemaByURLInput struct {
	ProjectID string
	TeamID    string
	URL       url.URL
}

// ---- Secondary ports -------------------------------------------------------------

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

func (s *SchemaService) CreateSchema(ctx context.Context, input CreateSchemaInput) (*domain.JSONSchema, error) {
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
		ProjectID: input.ProjectID,
		URL:       input.SchemaID,
		CreatedAt: time.Now().UTC(),
		Schema:    input.Schema,
	}

	err = s.schemaRepo.Create(ctx, tx, model)
	if err != nil {
		return nil, err
	}

	_, err = s.schemaResolver.Resolve(ctx, tx, input.ProjectID, input.SchemaID, nil)
	if err != nil {
		return nil, err
	}

	err = tx.Commit(ctx)
	if err != nil {
		return nil, errors.New(`domain.ErrInternal(err).WitMessage("failed to commit transaction")`)
	}

	return model, nil
}

func (s *SchemaService) CreateSchemaByUrl(ctx context.Context, input CreateSchemaByURLInput) (*domain.JSONSchema, error) {
	tx, err := s.pool.Begin(ctx, nil)
	if err != nil {
		return nil, errors.New(`domain.ErrInternal(err).WitMessage("failed to start transaction")`)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	strUri := input.URL.String()
	_, err = s.schemaResolver.Resolve(ctx, tx, input.ProjectID, strUri, nil)
	if err != nil {
		return nil, err
	}

	err = tx.Commit(ctx)
	if err != nil {
		return nil, errors.New(`domain.ErrInternal(err).WitMessage("failed to commit transaction")`)
	}

	// TODO(wim): Since repository does not yet have a get by id, we need to use the condition. This will change in the future
	return s.schemaRepo.Get(ctx, s.pool, database.WithCondition(s.schemaRepo.PrimaryKeyCondition(input.ProjectID, strUri)))
}

func (s *SchemaService) GetSchema(ctx context.Context, projectID string, teamID string, id string) (*domain.JSONSchema, error) {
	// TODO(wim): Since repository does not yet have a get by id, we need to use the condition. This will change in the future
	return s.schemaRepo.Get(ctx, s.pool, database.WithCondition(s.schemaRepo.PrimaryKeyCondition(projectID, id)))
}
