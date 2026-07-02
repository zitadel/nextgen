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
	Schema    []byte
}

type CreateSchemaByURLInput struct {
	ProjectID string
	TeamID    string
	URL       url.URL
}

type ListSchemasOutputItem struct {
	ID        string
	CreatedAt time.Time
}

// ---- Secondary ports -------------------------------------------------------------

type SchemaService struct {
	pool            database.Pool
	schemaRepo      domain.JSONSchemaRepository
	schemaResolver  *domain.JSONSchemaResolver
	schemaValidator *domain.SchemaValidator
}

func NewSchemaService(
	pool database.Pool,
	schemaRepo domain.JSONSchemaRepository,
	schemaResolver *domain.JSONSchemaResolver,
	schemaValidator *domain.SchemaValidator,
) *SchemaService {
	return &SchemaService{
		pool:            pool,
		schemaRepo:      schemaRepo,
		schemaResolver:  schemaResolver,
		schemaValidator: schemaValidator,
	}
}

func (s *SchemaService) CreateSchema(ctx context.Context, input CreateSchemaInput) (_ *domain.JSONSchema, err error) {
	tx, err := s.pool.Begin(ctx, nil)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to start transaction")
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	model, err := domain.NewJSONSchema(input.ProjectID, input.Schema)
	if err != nil {
		return nil, err
	}

	err = s.schemaValidator.ValidateAgainstMetaSchema(input.Schema)
	if err != nil {
		return nil, domain.ErrJSONSchemaInvalid().WithParent(err)
	}

	err = s.schemaRepo.Create(ctx, tx, model)
	if err != nil {
		if _, ok := errors.AsType[*database.IntegrityViolationError](err); ok {
			return nil, domain.ErrJSONSchemaAlreadyExists().WithParent(err)
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to create schema in database")
	}

	_, err = s.schemaResolver.Resolve(ctx, tx, input.ProjectID, model.URL, nil)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to resolve schema when creating")
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
	schema, err := s.schemaRepo.GetByID(ctx, s.pool, projectID, schemaID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrJSONSchemaNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get schema from database")
	}
	return schema, nil
}

func (s *SchemaService) ListSchemas(ctx context.Context, projectID, userType string, offset int, token string) ([]ListSchemasOutputItem, error) {
	conditions := []database.Condition{
		s.schemaRepo.ProjectIDCondition(projectID),
	}
	if userType != "" {
		conditions = append(conditions,
			s.schemaRepo.PayloadTextCondition(database.TextOperationEqual, userType, "userType"),
		)
	}

	// TODO: implement pagination

	opts := []database.QueryOption{
		database.WithCondition(database.And(conditions...)),
		database.WithOrderByDescending(s.schemaRepo.CreatedAt()),
	}

	schemas, err := s.schemaRepo.List(ctx, s.pool, opts...)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to list schemas")
	}

	output := make([]ListSchemasOutputItem, len(schemas), len(schemas))
	for i, schema := range schemas {
		output[i] = ListSchemasOutputItem{
			ID:        schema.URL,
			CreatedAt: schema.CreatedAt,
		}
	}

	return output, nil
}
