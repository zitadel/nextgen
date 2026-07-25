package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
)

type FlowDefinitionService interface {
	Create(ctx context.Context, req FlowDefinitionRequest) (*domain.FlowDefinition, error)
	Update(ctx context.Context, req FlowDefinitionRequest) (*domain.FlowDefinition, error)
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

type FlowDefinitionRequest struct {
	FlowDefinitionID string
	ProjectID        string
	Name             string
	Status           string
	SchemaVersion    string // todo (grvijayan): currently empty as the request does not contain schema version
	FlowSchemaURI    string // todo (grvijayan): schema_version (semver) stored in the db vs schema_uri needed for validation
	UserSchema       string
	Purposes         map[string]string
	Audience         domain.FlowDefinitionAudience
	Steps            []domain.FlowDefinitionStep
}

type flowDefinitionService struct {
	v2Pool                 *DB
	schemaGetter           SchemaGetter
	builtinSchemaProvider  BuiltinSchemaProvider
	validateFlowDefinition flowDefinitionValidatorFunc
}

func NewFlowDefinitionService(
	v2Pool *DB,
	schemaGetter SchemaGetter,
	schemaProvider BuiltinSchemaProvider,
	flowDefinitionValidatorFn flowDefinitionValidatorFunc,
) FlowDefinitionService {
	if flowDefinitionValidatorFn == nil {
		flowDefinitionValidatorFn = domain.ValidateFlowDefinition
	}
	return &flowDefinitionService{
		v2Pool:                 v2Pool,
		schemaGetter:           schemaGetter,
		builtinSchemaProvider:  schemaProvider,
		validateFlowDefinition: flowDefinitionValidatorFn,
	}
}

func (fd *flowDefinitionService) Create(ctx context.Context, req FlowDefinitionRequest) (*domain.FlowDefinition, error) {
	existing, err := fd.v2Pool.Statements().ListFlowDefinitions(ctx, &v2database.ListOptions[domain.FlowDefinitionField]{
		Filter: v2database.And(
			v2database.Equal(v2database.Col(domain.FlowDefinitionFieldProjectID), req.ProjectID),
			v2database.Equal(v2database.Col(domain.FlowDefinitionFieldName), req.Name),
			v2database.Equal(v2database.Col(domain.FlowDefinitionFieldSchemaVersion), req.SchemaVersion),
		),
	})
	if err != nil {
		return nil, err
	}
	if len(existing.Items) > 0 {
		return nil, domain.ErrFlowDefinitionAlreadyExists()
	}

	purposes, err := mapPurposesToDomain(req.Purposes)
	if err != nil {
		return nil, err
	}
	status, err := domain.FlowDefinitionStatusString(req.Status)
	if err != nil {
		return nil, domain.ErrFlowDefinitionInvalid(fmt.Sprintf("invalid status: %q", req.Status), err)
	}
	flowDefinition, err := domain.NewFlowDefinition(
		"",
		req.ProjectID,
		req.Name,
		req.SchemaVersion,
		req.UserSchema,
		purposes,
		req.Audience,
		req.Steps,
		status,
	)
	if err != nil {
		return nil, err
	}

	err = fd.Validate(ctx, flowDefinition)
	if err != nil {
		return nil, err
	}
	err = fd.v2Pool.Statements().CreateFlowDefinition(ctx, flowDefinition)
	if err != nil {
		return nil, err
	}
	return flowDefinition, nil
}

func (fd *flowDefinitionService) Update(ctx context.Context, req FlowDefinitionRequest) (*domain.FlowDefinition, error) {
	retrievedFlowDef, err := fd.Get(ctx, req.ProjectID, req.FlowDefinitionID)
	if err != nil {
		return nil, err
	}
	status, err := domain.FlowDefinitionStatusString(req.Status)
	if err != nil {
		return nil, domain.ErrFlowDefinitionInvalid(fmt.Sprintf("invalid status: %q", req.Status), err)
	}
	reqPurposes, err := mapPurposesToDomain(req.Purposes)
	if err != nil {
		return nil, err
	}
	err = fd.isUpdateAllowed(ctx, req.ProjectID, retrievedFlowDef.Status, status, retrievedFlowDef.Purposes, reqPurposes)
	if err != nil {
		return nil, err
	}
	flowDefinition, err := domain.NewFlowDefinition(
		req.FlowDefinitionID,
		req.ProjectID,
		req.Name,
		req.SchemaVersion,
		req.UserSchema,
		reqPurposes,
		req.Audience,
		req.Steps,
		status,
	)
	if err != nil {
		return nil, err
	}

	err = fd.Validate(ctx, flowDefinition)
	if err != nil {
		return nil, err
	}
	err = fd.v2Pool.Statements().UpdateFlowDefinition(ctx, flowDefinition)
	if err != nil {
		return nil, err
	}
	return flowDefinition, nil
}

func (fd *flowDefinitionService) isUpdateAllowed(
	ctx context.Context,
	projectID string,
	currentStatus, reqStatus domain.FlowDefinitionStatus,
	currentPurposes, reqPurposes map[domain.FlowDefinitionPurpose]string) error {
	if currentStatus != domain.FlowDefinitionStatusActive {
		return nil
	}

	if currentStatus == reqStatus && maps.Equal(currentPurposes, reqPurposes) {
		return nil
	}

	purposesToCheck := make(map[domain.FlowDefinitionPurpose]struct{})

	if reqStatus != domain.FlowDefinitionStatusActive {
		for p := range currentPurposes {
			purposesToCheck[p] = struct{}{}
		}
	} else {
		for p := range currentPurposes {
			if _, ok := reqPurposes[p]; !ok {
				purposesToCheck[p] = struct{}{}
			}
		}
	}

	if len(purposesToCheck) == 0 {
		return nil
	}

	for purpose := range purposesToCheck {
		fds, err := fd.v2Pool.Statements().ListFlowDefinitions(ctx, &v2database.ListOptions[domain.FlowDefinitionField]{
			Filter: v2database.And(
				v2database.Equal(v2database.Col(domain.FlowDefinitionFieldProjectID), projectID),
				v2database.Equal(v2database.Col(domain.FlowDefinitionFieldStatus), domain.FlowDefinitionStatusActive.String()),
				v2database.ArrayContains(v2database.Col(domain.FlowDefinitionFieldPurposes), purpose.String()),
			),
		})
		if err != nil {
			return domain.ErrInternal(err).WithMessage(fmt.Sprintf("failed to list flow definitions for old purpose %q", purpose))
		}
		if len(fds.Items) <= 1 {
			return domain.ErrFlowDefinitionUpdateConflict(fmt.Sprintf("cannot update: no other active flow definition found with purpose %q", purpose))
		}
	}
	return nil
}

func (fd *flowDefinitionService) Validate(ctx context.Context, flowDefinition *domain.FlowDefinition) error {
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

	pivotingTargets, err := fd.validateFlowDefinition(userSchema, *flowDefinition)
	if err != nil {
		return err
	}

	return fd.validatePivotingTargets(ctx, pivotingTargets, flowDefinition.ProjectID)
}

func (fd *flowDefinitionService) validatePivotingTargets(ctx context.Context, pivotingTargets []domain.PivotingTarget, projectID string) error {
	if len(pivotingTargets) == 0 {
		return nil
	}
	for _, target := range pivotingTargets {
		defs, err := fd.v2Pool.Statements().ListFlowDefinitions(ctx, &v2database.ListOptions[domain.FlowDefinitionField]{
			Filter: v2database.And(
				v2database.Equal(v2database.Col(domain.FlowDefinitionFieldProjectID), projectID),
				v2database.Equal(v2database.Col(domain.FlowDefinitionFieldName), target.Name),
				v2database.Equal(v2database.Col(domain.FlowDefinitionFieldStatus), domain.FlowDefinitionStatusActive.String()),
			),
		})
		if err != nil {
			return err
		}
		if len(defs.Items) == 0 {
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
	definition, err := fd.v2Pool.Statements().GetFlowDefinitionByID(ctx, projectID, id)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
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
	filters := []v2database.Filter[domain.FlowDefinitionField]{
		v2database.Equal(v2database.Col(domain.FlowDefinitionFieldProjectID), req.ProjectID),
	}
	if req.Purpose != "" {
		purpose, err := domain.FlowDefinitionPurposeString(req.Purpose)
		if err != nil {
			return nil, domain.ErrFlowDefinitionInvalid("invalid purpose", nil)
		}
		filters = append(filters, v2database.ArrayContains(v2database.Col(domain.FlowDefinitionFieldPurposes), purpose.String()))
	}
	opts := &v2database.ListOptions[domain.FlowDefinitionField]{
		Filter: v2database.And(filters...),
	}
	if req.Limit > 0 {
		opts.Pagination.Limit = uint32(req.Limit)
	}
	result, err := fd.v2Pool.Statements().ListFlowDefinitions(ctx, opts)
	if err != nil {
		return nil, err
	}
	return result.Items, nil
}

func (fd *flowDefinitionService) Delete(ctx context.Context, projectID, id string) error {
	if projectID == "" {
		return domain.ErrMissingProjectID()
	}
	if id == "" {
		return domain.ErrMissingFlowDefinitionID()
	}
	return fd.v2Pool.Statements().DeleteFlowDefinitionByID(ctx, projectID, id)
}
