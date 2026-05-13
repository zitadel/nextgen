package service

import (
	"context"
	"net/url"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/pkg/errors"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/idgen"
)

type SchemaFetcher interface {
	Get(ctx context.Context, projectID string, teamID string, uri url.URL) (schema *jsonschema.Schema, err error)
}
type SchemaSaver interface {
	Save(ctx context.Context, projectID string, teamID string, uri url.URL, schema *jsonschema.Schema) error
}
type SchemaValidator interface {
	Validate(ctx context.Context, schema *jsonschema.Schema) error
}

type SchemaService struct {
	databaseSchemaFetcher SchemaFetcher
	databaseSchemaSaver   SchemaSaver
	remoteSchemaFetcher   SchemaFetcher
	idGenerator           idgen.Generator
	schemaValidator       SchemaValidator
}

func NewSchemaService(
	databaseSchemaFetcher SchemaFetcher,
	databaseSchemaSaver SchemaSaver,
	remoteSchemaFetcher SchemaFetcher,
	idGenerator idgen.Generator,
	schemaValidator SchemaValidator,
) *SchemaService {
	return &SchemaService{
		databaseSchemaFetcher: databaseSchemaFetcher,
		databaseSchemaSaver:   databaseSchemaSaver,
		remoteSchemaFetcher:   remoteSchemaFetcher,
		idGenerator:           idGenerator,
		schemaValidator:       schemaValidator,
	}
}

func (s *SchemaService) CreateSchema(ctx context.Context, projectID string, teamID string, schema *jsonschema.Schema) (*url.URL, error) {
	id, err := s.idGenerator.New("sch")
	if err != nil {
		return nil, &FailedToGenerateSchemaIdError{err}
	}

	uri, err := domain.CreateSchemaUrlFromId(id)
	if err != nil {
		return nil, &FailedToGenerateSchemaIdError{err}
	}

	err = s.schemaValidator.Validate(ctx, schema)
	if err != nil {
		return nil, &InvalidJsonSchemaError{err}
	}

	err = s.databaseSchemaSaver.Save(ctx, projectID, teamID, *uri, schema)
	if err != nil {
		return nil, &FailedToSaveSchema{err}
	}

	return uri, nil
}

func (s *SchemaService) CreateSchemaByUrl(ctx context.Context, projectID string, teamID string, uri url.URL) error {
	existing, err := s.databaseSchemaFetcher.Get(ctx, projectID, teamID, uri)
	if existing != nil {
		return SchemaAlreadyExistsError
	}

	if err != nil && !errors.Is(err, RepositoryErrorNotFound) {
		return &FailedToGetSchemaError{cause: err}
	}

	schema, err := s.remoteSchemaFetcher.Get(ctx, projectID, teamID, uri)
	if err != nil {
		return &FailedToFetchSchemaError{err}
	}

	err = s.schemaValidator.Validate(ctx, schema)
	if err != nil {
		return &InvalidJsonSchemaError{err}
	}

	err = s.databaseSchemaSaver.Save(ctx, projectID, teamID, uri, schema)
	if err != nil {
		return &FailedToSaveSchema{err}
	}

	return nil
}

func (s *SchemaService) GetSchema(ctx context.Context, projectID string, teamID string, uri url.URL) (*jsonschema.Schema, error) {
	schema, err := s.databaseSchemaFetcher.Get(ctx, projectID, teamID, uri)
	if err != nil {
		if errors.Is(err, RepositoryErrorNotFound) {
			return nil, SchemaNotFoundError
		}
		return nil, &FailedToGetSchemaError{cause: err}
	}
	return schema, nil
}

// ----------------- ERRORS ------------------------

var SchemaAlreadyExistsError = errors.New("schema already exists")
var SchemaNotFoundError = errors.New("schema could not be found")

type FailedToGetSchemaError struct {
	cause error
}

func (e *FailedToGetSchemaError) Error() string {
	return "failed to get the schema from storage: " + e.cause.Error()
}

func (e *FailedToGetSchemaError) Unwrap() error {
	return e.cause
}

type FailedToFetchSchemaError struct {
	cause error
}

func (e *FailedToFetchSchemaError) Error() string {
	return "failed to fetch schema from url"
}

func (e *FailedToFetchSchemaError) Unwrap() error {
	return e.cause
}

type FailedToGenerateSchemaIdError struct {
	cause error
}

func (e *FailedToGenerateSchemaIdError) Error() string {
	return "failed to generate id for schema"
}

func (e *FailedToGenerateSchemaIdError) Unwrap() error {
	return e.cause
}

type FailedToSaveSchema struct {
	cause error
}

func (e *FailedToSaveSchema) Error() string {
	return "failed to save schema to storage"
}

func (e *FailedToSaveSchema) Unwrap() error {
	return e.cause
}

type InvalidJsonSchemaError struct {
	cause error
}

func (e *InvalidJsonSchemaError) Error() string {
	return "invalid json-schema"
}

func (e *InvalidJsonSchemaError) Unwrap() error {
	return e.cause
}

// TODO: get correct error from repository package

var RepositoryErrorNotFound = errors.New("no entity could be found")
