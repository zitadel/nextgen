package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/idgen"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type FlowDefinitionService interface {
	Create(ctx context.Context, req CreateFlowDefinitionRequest) (*domain.FlowDefinition, string, error)
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
	GetBuiltinSchema(uri string) (*jsonschema.Schema, error)
	LatestSchemaURI(kind domain.KnownSchemaKind) (string, error)
}

type flowDefinitionValidatorFunc func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error)

type CreateFlowDefinitionRequest struct {
	ProjectID         string
	Name              string
	SchemaVersion     string // todo (grvijayan): currently empty as the request does not contain schema version
	FlowSchemaURI     string // todo (grvijayan): schema_version (semver) stored in the db vs schema_uri needed for validation
	UserSchema        string
	Purposes          map[string]string
	Audience          domain.FlowDefinitionAudience
	Steps             []domain.FlowDefinitionStep
	RawFlowDefinition []byte
}

type flowDefinitionService struct {
	db                     database.Pool
	schemaResolver         SchemaResolver
	builtinSchemaProvider  BuiltinSchemaProvider
	validateFlowDefinition flowDefinitionValidatorFunc
	flowDefinitionRepo     domain.FlowDefinitionRepository
}

func NewFlowDefinitionService(
	db database.Pool,
	schemaResolver SchemaResolver,
	schemaProvider BuiltinSchemaProvider,
	flowDefinitionValidatorFn flowDefinitionValidatorFunc,
	flowDefinitionRepo domain.FlowDefinitionRepository,
) FlowDefinitionService {
	if flowDefinitionValidatorFn == nil {
		flowDefinitionValidatorFn = domain.ValidateFlowDefinition
	}
	return &flowDefinitionService{
		db:                     db,
		schemaResolver:         schemaResolver,
		builtinSchemaProvider:  schemaProvider,
		validateFlowDefinition: flowDefinitionValidatorFn,
		flowDefinitionRepo:     flowDefinitionRepo,
	}
}

func (fd *flowDefinitionService) Create(ctx context.Context, req CreateFlowDefinitionRequest) (*domain.FlowDefinition, string, error) {
	// check if a flow definition (name + schema version) already exists in the project
	opts := []domain.FlowDefinitionListOption{
		domain.WithFlowDefinitionName(req.Name),
		domain.WithSchemaVersion(req.SchemaVersion),
	}
	defs, err := fd.flowDefinitionRepo.ListFlowDefinitions(ctx, fd.db, req.ProjectID, opts...)
	if err != nil {
		if !errors.Is(err, &database.NoRowFoundError{}) {
			return nil, "", err
		}
	}
	if len(defs) > 0 {
		return nil, "", domain.ErrFlowDefinitionAlreadyExists()
	}

	ulidGen := idgen.NewULID()
	flowDefID, err := ulidGen.New(string(domain.PrefixFlowDefinition))
	if err != nil {
		return nil, "", domain.ErrInternal(err)
	}

	purposes, err := mapPurposesToDomain(req.Purposes)
	if err != nil {
		return nil, "", err
	}

	flowDefinition := domain.FlowDefinition{
		ID:            flowDefID,
		ProjectID:     req.ProjectID,
		Name:          req.Name,
		SchemaVersion: req.SchemaVersion,
		UserSchema:    req.UserSchema,
		Purposes:      purposes,
		Audience:      req.Audience,
		Steps:         req.Steps,
	}
	// if req.FlowSchemaURI is empty, use the latest flow definition schema from the builtin schema provider
	flowSchemaURI := req.FlowSchemaURI
	if flowSchemaURI == "" {
		flowSchemaURI, err = fd.builtinSchemaProvider.LatestSchemaURI(domain.SchemaKindFlowDefinition)
		if err != nil {
			return nil, "", domain.ErrSchemaFetchFailed("failed to get latest flow definition schema URI", err)
		}
	}
	err = fd.Validate(ctx, flowDefinition, flowSchemaURI, req.RawFlowDefinition)
	if err != nil {
		return nil, "", err
	}
	now := time.Now()
	flowDefinition.CreatedAt = now
	flowDefinition.UpdatedAt = now
	flowDefinition.Status = domain.FlowDefinitionStatusActive
	err = fd.flowDefinitionRepo.CreateFlowDefinition(ctx, fd.db, &flowDefinition)
	if err != nil {
		return nil, "", err
	}
	return &flowDefinition, flowSchemaURI, nil
}

// Validate validates the flow definition steps and transitions
func (fd *flowDefinitionService) Validate(ctx context.Context, flowDefinition domain.FlowDefinition, flowSchemaURI string, flowDefinitionRaw []byte) error {
	// 1. structural validation against the flow definition schema
	if err := fd.validateAgainstSchema(flowSchemaURI, flowDefinitionRaw); err != nil {
		return err
	}

	// resolve the user schema from the user schema URI
	userSchema, err := fd.schemaResolver.Resolve(ctx, fd.db, flowDefinition.ProjectID, flowDefinition.UserSchema, nil)
	if err != nil {
		return domain.ErrSchemaFetchFailed("failed to resolve tenant user schema", err)
	}

	// validate the flow steps, fields against the user schema, transitions, reachability, trapped cycles, etc.
	pivotingTargets, err := fd.validateFlowDefinition(userSchema, flowDefinition)
	if err != nil {
		return err
	}

	// validate that the pivoting targets returned by the flow definition validator are valid flow definitions in the same project
	return fd.validatePivotingTargets(ctx, pivotingTargets, flowDefinition.ProjectID)

}

// validateAgainstSchema validates the flow definition against the flow definition schema.
// If wantFlowSchemaURI is empty, the latest flow definition schema is used.
func (fd *flowDefinitionService) validateAgainstSchema(flowSchemaURI string, flowDefinition []byte) (err error) {
	flowDefinitionSchema, err := fd.builtinSchemaProvider.GetBuiltinSchema(flowSchemaURI)
	if err != nil {
		return domain.ErrSchemaFetchFailed("failed to fetch flow definition schema", err)
	}

	var instance any
	err = json.Unmarshal(flowDefinition, &instance)
	if err != nil {
		return domain.ErrFlowDefinitionInvalid("invalid flow definition JSON", err)
	}
	err = flowDefinitionSchema.Validate(instance)
	if err != nil {
		// domain.FlattenValidationErrors(err) can be used to get individual errors
		return domain.ErrFlowDefinitionInvalid(fmt.Sprintf("flow definition does not conform to schema %q", flowSchemaURI), err)
	}
	return nil
}

// validatePivotingTargets validates that the pivoting targets are a valid flow definition in the same project.
func (fd *flowDefinitionService) validatePivotingTargets(ctx context.Context, pivotingTargets []domain.PivotingTarget, projectID string) error {
	if len(pivotingTargets) == 0 {
		return nil
	}
	for _, target := range pivotingTargets {
		defs, err := fd.flowDefinitionRepo.ListFlowDefinitions(ctx, fd.db, projectID,
			domain.WithFlowDefinitionName(target.Name),
			domain.WithFlowDefinitionStatus(domain.FlowDefinitionStatusActive),
		)
		if err != nil {
			return err
		}
		if len(defs) == 0 {
			return domain.ErrFlowDefinitionInvalid(fmt.Sprintf(
				"step %q: transition %q targets unknown or inactive flow %q", target.Step, target.Transition, target.Name), nil)
		}
	}
	return nil
}

func mapPurposesToDomain(reqPurposes map[string]string) (map[domain.FlowDefinitionPurpose]string, error) {
	purposes := make(map[domain.FlowDefinitionPurpose]string, len(reqPurposes))
	for p, entryStep := range reqPurposes {
		purpose, err := domain.FlowDefinitionPurposeString(p)
		if err != nil {
			return nil, domain.ErrFlowDefinitionInvalid("invalid purpose", nil)
		}
		purposes[purpose] = entryStep
	}
	return purposes, nil
}
