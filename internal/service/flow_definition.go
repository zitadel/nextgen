package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type FlowDefinitionService interface {
	Create(ctx context.Context, req CreateFlowDefinitionRequest) (*domain.FlowDefinition, error)
	Get(ctx context.Context, projectID, id string) (*domain.FlowDefinition, error)
	List(ctx context.Context, req ListFlowDefinitionsRequest) ([]*domain.FlowDefinition, error)
	Delete(ctx context.Context, projectID string, id string) error
}

type SchemaGetter interface {
	GetSchema(ctx context.Context, projectID string, teamID string, schemaID string) (*domain.JSONSchema, error)
}

type BuiltinSchemaProvider interface {
	GetBuiltinSchema(uri string) (*jsonschema.Schema, error)
	LatestSchemaURI(kind domain.KnownSchemaKind) (string, error)
}

type flowDefinitionValidatorFunc func(userSchema *jsonschema.Schema, flowDefinition domain.FlowDefinition) ([]domain.PivotingTarget, error)

type CreateFlowDefinitionRequest struct {
	ProjectID     string
	Name          string
	SchemaVersion string // todo (grvijayan): currently empty as the request does not contain schema version
	FlowSchemaURI string // todo (grvijayan): schema_version (semver) stored in the db vs schema_uri needed for validation
	UserSchema    string
	Purposes      map[string]string
	Audience      domain.FlowDefinitionAudience
	Steps         []domain.FlowDefinitionStep
}

type flowDefinitionService struct {
	db                     database.Pool
	schemaGetter           SchemaGetter
	builtinSchemaProvider  BuiltinSchemaProvider
	validateFlowDefinition flowDefinitionValidatorFunc
	flowDefinitionRepo     domain.FlowDefinitionRepository
}

func NewFlowDefinitionService(
	db database.Pool,
	schemaGetter SchemaGetter,
	schemaProvider BuiltinSchemaProvider,
	flowDefinitionValidatorFn flowDefinitionValidatorFunc,
	flowDefinitionRepo domain.FlowDefinitionRepository,
) FlowDefinitionService {
	if flowDefinitionValidatorFn == nil {
		flowDefinitionValidatorFn = domain.ValidateFlowDefinition
	}
	return &flowDefinitionService{
		db:                     db,
		schemaGetter:           schemaGetter,
		builtinSchemaProvider:  schemaProvider,
		validateFlowDefinition: flowDefinitionValidatorFn,
		flowDefinitionRepo:     flowDefinitionRepo,
	}
}

func (fd *flowDefinitionService) Create(ctx context.Context, req CreateFlowDefinitionRequest) (*domain.FlowDefinition, error) {
	// check if a flow definition (name + schema version) already exists in the project
	opts := []domain.FlowDefinitionListOption{
		domain.WithFlowDefinitionName(req.Name),
		domain.WithSchemaVersion(req.SchemaVersion),
	}
	defs, err := fd.flowDefinitionRepo.ListFlowDefinitions(ctx, fd.db, req.ProjectID, opts...)
	if err != nil {
		if !errors.Is(err, &database.NoRowFoundError{}) {
			return nil, err
		}
	}
	if len(defs) > 0 {
		return nil, domain.ErrFlowDefinitionAlreadyExists()
	}

	purposes, err := mapPurposesToDomain(req.Purposes)
	if err != nil {
		return nil, err
	}

	flowDefinition, err := domain.NewFlowDefinition(
		req.ProjectID,
		req.Name,
		req.SchemaVersion,
		req.UserSchema,
		purposes,
		req.Audience,
		req.Steps,
	)
	if err != nil {
		return nil, err
	}

	err = fd.Validate(ctx, flowDefinition)
	if err != nil {
		return nil, err
	}
	err = fd.flowDefinitionRepo.CreateFlowDefinition(ctx, fd.db, flowDefinition)
	if err != nil {
		return nil, err
	}
	return flowDefinition, nil
}

// Validate validates the flow definition steps and transitions
func (fd *flowDefinitionService) Validate(ctx context.Context, flowDefinition *domain.FlowDefinition) error {
	// resolve the user schema from the user schema URI
	sch, err := fd.schemaGetter.GetSchema(ctx, flowDefinition.ProjectID, "", flowDefinition.UserSchema)
	if err != nil {
		if errors.Is(err, domain.ErrJSONSchemaNotFound()) {
			return domain.ErrFlowDefinitionInvalid(fmt.Sprintf("user schema %q not found", flowDefinition.UserSchema), err)
		}
		return domain.ErrSchemaFetchFailed("failed to fetch user schema", err)
	}

	var userSchema *jsonschema.Schema
	err = json.Unmarshal(sch.Schema, &userSchema)
	if err != nil {
		return domain.ErrSchemaFetchFailed("failed to unmarshal user schema", err)
	}

	// validate the flow steps, fields against the user schema, transitions, reachability, trapped cycles, etc.
	pivotingTargets, err := fd.validateFlowDefinition(userSchema, *flowDefinition)
	if err != nil {
		return err
	}

	// validate that the pivoting targets returned by the flow definition validator are valid flow definitions in the same project
	return fd.validatePivotingTargets(ctx, pivotingTargets, flowDefinition.ProjectID)

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

func (fd *flowDefinitionService) Get(ctx context.Context, projectID, id string) (*domain.FlowDefinition, error) {
	// todo (grvijayan): get the project ID from the context when the functionality is implemented
	if projectID == "" {
		return nil, domain.ErrMissingProjectID()
	}
	if id == "" {
		return nil, domain.ErrMissingFlowDefinitionID()
	}
	definition, err := fd.flowDefinitionRepo.GetFlowDefinition(ctx, fd.db, projectID, id)
	if err != nil {
		if errors.Is(err, &database.NoRowFoundError{}) {
			return nil, domain.ErrFlowDefinitionNotFound()
		}
		return nil, err
	}
	return definition, nil
}

type ListFlowDefinitionsRequest struct {
	ProjectID string
	Purpose   string
	Limit     int
	PageToken string
}

func (fd *flowDefinitionService) List(ctx context.Context, req ListFlowDefinitionsRequest) ([]*domain.FlowDefinition, error) {
	// todo (grvijayan): get the project ID from the context when the functionality is implemented
	if req.ProjectID == "" {
		return nil, domain.ErrMissingProjectID()
	}
	var filterOpts []domain.FlowDefinitionListOption
	if req.Purpose != "" {
		purpose, err := domain.FlowDefinitionPurposeString(req.Purpose)
		if err != nil {
			return nil, domain.ErrFlowDefinitionInvalid("invalid purpose", nil)
		}
		filterOpts = append(filterOpts, domain.WithFlowDefinitionPurpose(purpose))
	}
	// todo: the repository layer supports offset at the moment, but not page token
	if req.Limit > 0 {
		filterOpts = append(filterOpts, domain.WithFlowDefinitionLimit(uint32(req.Limit)))
	}
	defs, err := fd.flowDefinitionRepo.ListFlowDefinitions(
		ctx,
		fd.db,
		req.ProjectID,
		filterOpts...,
	)
	if err != nil {
		return nil, err
	}
	return defs, nil
}

func (fd *flowDefinitionService) Delete(ctx context.Context, projectID, id string) error {
	err := fd.flowDefinitionRepo.DeleteFlowDefinition(ctx, fd.db, projectID, id)
	if err != nil {
		if errors.Is(err, &database.NoRowFoundError{}) {
			return domain.ErrFlowDefinitionNotFound()
		}
		return err
	}
	return nil
}
