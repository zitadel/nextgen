package service

import (
	"context"
	"encoding/json"
	"fmt"
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
	pool            database.Pool
	schemaRepo      domain.JSONSchemaRepository
	schemaResolver  *domain.JSONSchemaResolver
	schemaValidator *domain.TenantSchemaValidator
}

func NewSchemaService(
	pool database.Pool,
	schemaRepo domain.JSONSchemaRepository,
	schemaResolver *domain.JSONSchemaResolver,
	schemaValidator *domain.TenantSchemaValidator,
) *SchemaService {
	return &SchemaService{
		pool:            pool,
		schemaRepo:      schemaRepo,
		schemaResolver:  schemaResolver,
		schemaValidator: schemaValidator,
	}
}

func (s *SchemaService) CreateSchema(ctx context.Context, input CreateSchemaInput) (*domain.JSONSchema, error) {
	tx, txErr := s.pool.Begin(ctx, nil)
	if txErr != nil {
		return nil, domain.ErrInternal(txErr).WithMessage("failed to start transaction")
	}
	defer func() {
		if txErr != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	var tenantSchema map[string]any
	if err := json.Unmarshal(input.Schema, &tenantSchema); err != nil {
		return nil, fmt.Errorf("%w: %w", "ErrSchemaParseFailed", err)
	}

	model := &domain.JSONSchema{
		ProjectID: input.ProjectID,
		URL:       input.SchemaID,
		CreatedAt: time.Now().UTC(),
		Schema:    input.Schema,
	}

	err := s.schemaRepo.Create(ctx, tx, model)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to create schema in database")
	}

	_, err = s.schemaResolver.Resolve(ctx, tx, input.ProjectID, input.SchemaID, nil)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to resolve schema when creating")
	}

	err = s.schemaValidator.ValidateAgainstMetaSchema(input.Schema)
	if err != nil {
		return nil, domain.ErrRequestInvalid().WithParent(err).WithMessage("invalid schema")
	}

	err = tx.Commit(ctx)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to commit transaction")
	}

	return model, nil
}

func (s *SchemaService) CreateSchemaByUrl(ctx context.Context, input CreateSchemaByURLInput) (*domain.JSONSchema, error) {
	tx, err := s.pool.Begin(ctx, nil)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to start transaction")
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	strUri := input.URL.String()
	_, err = s.schemaResolver.Resolve(ctx, tx, input.ProjectID, strUri, nil)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to resolve schema when creating")
	}

	err = tx.Commit(ctx)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to commit transaction")
	}

	return s.schemaRepo.GetByID(ctx, s.pool, input.ProjectID, strUri)
}

func (s *SchemaService) GetSchema(ctx context.Context, projectID string, teamID string, schemaID string) (*domain.JSONSchema, error) {
	return s.schemaRepo.GetByID(ctx, s.pool, projectID, schemaID)
}
