package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type FlowDefinitionService interface {
	Create(ctx context.Context, req FlowDefinitionRequest) (*domain.FlowDefinition, error)
	Get(ctx context.Context, projectID, id string) (*domain.FlowDefinition, error)
	List(ctx context.Context, req ListFlowDefinitionsRequest) (*ListFlowDefinitionsResponse, error)
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
	ProjectID     string
	Name          string
	Status        string
	SchemaVersion string // todo (grvijayan): currently empty as the request does not contain schema version
	FlowSchemaURI string // todo (grvijayan): schema_version (semver) stored in the db vs schema_uri needed for validation
	UserSchema    string
	Purposes      map[string]string
	Audience      domain.FlowDefinitionAudience
	Steps         []domain.FlowDefinitionStep
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
	err = fd.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := tx.Statements().CreateFlowDefinition(ctx, flowDefinition); err != nil {
			return err
		}
		return audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
			Type:       domain.EventTypeFlowdefCreated,
			Category:   domain.EventCategoryAdmin,
			ProjectID:  flowDefinition.ProjectID,
			EntityType: "flow_definition",
			EntityID:   flowDefinition.ID,
			Payload:    domain.FlowdefPayloadSnapshot(flowDefinition),
		})
	})
	if err != nil {
		return nil, err
	}
	return flowDefinition, nil
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
		defs, err := fd.v2Pool.Statements().ListFlowDefinitions(WithAuthzListUnrestricted(ctx), &database.ListOptions[domain.FlowDefinitionField]{
			Filter: database.And(
				database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), projectID),
				database.Equal(database.Col(domain.FlowDefinitionFieldName), target.Name),
				database.Equal(database.Col(domain.FlowDefinitionFieldStatus), domain.FlowDefinitionStatusActive.String()),
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
	Name      string
	Limit     int
	PageToken string
}

type ListFlowDefinitionsResponse struct {
	Items         []*domain.FlowDefinition
	NextPageToken string
}

func (fd *flowDefinitionService) List(ctx context.Context, req ListFlowDefinitionsRequest) (*ListFlowDefinitionsResponse, error) {
	// todo (grvijayan): get the project ID from the context when the functionality is implemented
	if req.ProjectID == "" {
		return nil, domain.ErrMissingProjectID()
	}
	filters := []database.Filter[domain.FlowDefinitionField]{
		database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), req.ProjectID),
	}
	if req.Purpose != "" {
		purpose, err := domain.FlowDefinitionPurposeString(req.Purpose)
		if err != nil {
			return nil, domain.ErrFlowDefinitionInvalid("invalid purpose", nil)
		}
		filters = append(filters, database.ArrayContains(database.Col(domain.FlowDefinitionFieldPurposes), purpose.String()))
	}
	if req.Name != "" {
		filters = append(filters, database.Equal(database.Col(domain.FlowDefinitionFieldName), req.Name))
	}
	var cursor []byte
	if req.PageToken != "" {
		cursor = []byte(req.PageToken)
	}
	opts := &database.ListOptions[domain.FlowDefinitionField]{
		Filter: database.And(filters...),
		Pagination: database.Page[domain.FlowDefinitionField]{
			Limit:  uint32(normalizeLimit(req.Limit)),
			Cursor: cursor,
		},
	}
	result, err := fd.v2Pool.Statements().ListFlowDefinitions(ctx, opts)
	if err != nil {
		return nil, mapListError(err, "failed to list flow definitions")
	}
	return &ListFlowDefinitionsResponse{
		Items:         result.Items,
		NextPageToken: string(result.NextCursor),
	}, nil
}
