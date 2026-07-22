package service

import (
	"context"
	"errors"
	"net/url"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
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
	v2Pool          *DB
	schemaResolver  *domain.JSONSchemaResolver
	schemaValidator *domain.SchemaValidator
}

func NewSchemaService(
	v2Pool *DB,
	schemaResolver *domain.JSONSchemaResolver,
	schemaValidator *domain.SchemaValidator,
) *SchemaService {
	return &SchemaService{
		v2Pool:          v2Pool,
		schemaResolver:  schemaResolver,
		schemaValidator: schemaValidator,
	}
}

func (s *SchemaService) CreateSchema(ctx context.Context, input CreateSchemaInput) (_ *domain.JSONSchema, err error) {
	model, err := domain.NewJSONSchema(input.ProjectID, input.Schema)
	if err != nil {
		return nil, err
	}

	err = s.schemaValidator.ValidateAgainstMetaSchema(input.Schema)
	if err != nil {
		return nil, domain.ErrJSONSchemaInvalid().WithParent(err)
	}

	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		if err := stmts.CreateJSONSchema(ctx, model); err != nil {
			if _, ok := errors.AsType[*database.IntegrityViolationError](err); ok {
				return domain.ErrJSONSchemaAlreadyExists().WithParent(err)
			}
			return domain.ErrInternal(err).WithMessage("failed to create schema in database")
		}

		// Pass the just-created payload so Resolve does not re-load (or HTTP-refetch
		// and re-insert) the same URL inside this transaction — Spanner can surface
		// the duplicate as a commit-time AlreadyExists otherwise.
		_, err := s.schemaResolver.Resolve(ctx, stmts, input.ProjectID, model.URL, model.Schema)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to resolve schema when creating")
		}
		return nil
	})
	if err != nil {
		var de domain.Error
		if errors.As(err, &de) {
			return nil, de
		}
		if _, ok := errors.AsType[*database.IntegrityViolationError](err); ok {
			return nil, domain.ErrJSONSchemaAlreadyExists().WithParent(err)
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to commit transaction")
	}

	return model, nil
}

func (s *SchemaService) CreateSchemaByUrl(ctx context.Context, input CreateSchemaByURLInput) (*domain.JSONSchema, error) {
	strURI := input.URL.String()
	err := s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		_, err := s.schemaResolver.Resolve(ctx, tx.Statements(), input.ProjectID, strURI, nil)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to resolve schema when creating")
		}
		return nil
	})
	if err != nil {
		var de domain.Error
		if errors.As(err, &de) {
			return nil, de
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to commit transaction")
	}

	return s.v2Pool.Statements().GetJSONSchemaByID(ctx, input.ProjectID, strURI)
}

func (s *SchemaService) GetSchema(ctx context.Context, projectID string, teamID string, schemaID string) (*domain.JSONSchema, error) {
	schema, err := s.v2Pool.Statements().GetJSONSchemaByID(ctx, projectID, schemaID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrJSONSchemaNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get schema from database")
	}
	return schema, nil
}

func (s *SchemaService) ListSchemas(ctx context.Context, projectID, objectType string, offset int, token string) ([]ListSchemasOutputItem, error) {
	filters := []v2database.Filter[domain.JSONSchemaField]{
		v2database.Equal(v2database.Col(domain.JSONSchemaFieldProjectID), projectID),
	}
	if objectType != "" {
		filters = append(filters,
			v2database.Equal(v2database.Col(domain.JSONSchemaFieldObjectType), objectType),
		)
	}

	// TODO: implement pagination

	result, err := s.v2Pool.Statements().ListJSONSchemas(ctx, &v2database.ListOptions[domain.JSONSchemaField]{
		Filter: v2database.And(filters...),
		Pagination: v2database.Page[domain.JSONSchemaField]{
			OrderBy: v2database.OrderBy[domain.JSONSchemaField]{
				Columns:   []v2database.Column[domain.JSONSchemaField]{v2database.Col(domain.JSONSchemaFieldCreatedAt)},
				Direction: v2database.OrderDesc,
			},
		},
	})
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to list schemas")
	}

	// TODO: make list not return the entire schema, just the fields we want
	output := make([]ListSchemasOutputItem, len(result.Items))
	for i, schema := range result.Items {
		output[i] = ListSchemasOutputItem{
			ID:        schema.URL,
			CreatedAt: schema.CreatedAt,
		}
	}

	return output, nil
}
