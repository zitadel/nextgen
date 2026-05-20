package service

import (
	"context"
	"errors"
	"fmt"
	"net/url"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

var (
	ErrUserSchemaResolution = errors.New("failed to resolve user schema")
)

type FlowDefinitionService interface {
	Create(ctx context.Context, req CreateFlowDefinitionRequest) (*domain.FlowDefinition, error)
}

type SchemaResolver interface {
	Resolve(
		ctx context.Context,
		client database.QueryExecutor,
		projectID string,
		schemaURL string,
		rootSchema []byte,
	) (*jsonschema.Schema, error)
}

type BuiltinSchemaProvider interface {
	GetBuiltinSchema(kind domain.KnownSchemaKind) *jsonschema.Schema
}

type CreateFlowDefinitionRequest struct {
	domain.FlowDefinition
	FlowSchemaURI     url.URL // todo: schema_version (semver) stored in the db vs schema_uri needed for validation
	RawFlowDefinition []byte  // todo: is there a better way to do this for validation?
}

type flowDefinitionService struct {
	db                    database.Pool
	schemaResolver        SchemaResolver
	builtinSchemaProvider BuiltinSchemaProvider
}

func NewFlowDefinitionService(resolver SchemaResolver, validator BuiltinSchemaProvider) FlowDefinitionService {
	return &flowDefinitionService{
		schemaResolver:        resolver,
		builtinSchemaProvider: validator,
	}
}

func (fd *flowDefinitionService) Create(ctx context.Context, req CreateFlowDefinitionRequest) (*domain.FlowDefinition, error) {
	err := fd.Validate(ctx, req.ProjectID, req.FlowDefinition.UserSchema.String(), req.RawFlowDefinition)
	if err != nil {
		return nil, err
	}
	return nil, nil
}

// Validate validates the flow definition steps and transitions
func (fd *flowDefinitionService) Validate(ctx context.Context, projectID, userSchemaURI string, flowDefinition []byte) error {
	// structural validation against the flow definition schema
	// todo: fetching by schema version isn't supported yet
	flowDefinitionSchema := fd.builtinSchemaProvider.GetBuiltinSchema(domain.SchemaKindFlowDefinition)
	err := flowDefinitionSchema.Validate(flowDefinition)
	if err != nil {
		// domain.FlattenValidationErrors(err) can be used to get individual errors
		return err
	}

	// validate against the user schema
	// resolve the user schema from the user schema URI
	_, err = fd.schemaResolver.Resolve(ctx, fd.db, projectID, userSchemaURI, nil)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrUserSchemaResolution, err)
	}
	// extract the field names from the user schema relevant for the flow definition

	// validate the flow definition steps and transition

	return nil
}
