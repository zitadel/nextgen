package service

import (
	"context"
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
	builtinSchemaProvider  BuiltinSchemaProvider
	validateFlowDefinition flowDefinitionValidatorFunc
}

func NewFlowDefinitionService(
	v2Pool *DB,
	schemaProvider BuiltinSchemaProvider,
	flowDefinitionValidatorFn flowDefinitionValidatorFunc,
) *flowDefinitionService {
	if flowDefinitionValidatorFn == nil {
		flowDefinitionValidatorFn = domain.ValidateFlowDefinition
	}
	return &flowDefinitionService{
		v2Pool:                 v2Pool,
		builtinSchemaProvider:  schemaProvider,
		validateFlowDefinition: flowDefinitionValidatorFn,
	}
}

func (fd *flowDefinitionService) Create(ctx context.Context, req FlowDefinitionRequest) (*domain.FlowDefinition, error) {
	stmts := fd.v2Pool.Statements()
	userSchema, err := resolveUserSchema(ctx, stmts, req.ProjectID, req.UserSchema)
	if err != nil {
		if errors.Is(err, domain.ErrJSONSchemaNotFound()) {
			return nil, domain.ErrFlowDefinitionInvalid(fmt.Sprintf("user schema %q not found", req.UserSchema), err)
		}
		return nil, domain.ErrSchemaFetchFailed("failed to fetch user schema", err)
	}
	flowDefinition, err := fd.prepareFlowDefinition(ctx, stmts, req, userSchema)
	if err != nil {
		return nil, err
	}
	err = fd.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		return fd.createFlowDefinition(ctx, tx.Statements(), flowDefinition)
	})
	if err != nil {
		// The id is server-minted, so the only unique constraint a create can
		// lose is (project_id, name, created_at): another revision of the same
		// flow landed on the same instant. Other integrity violations (foreign
		// key, check) are not that race and keep their own semantics.
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			return nil, domain.ErrFlowDefinitionRevisionConflict().WithParent(err)
		}
		return nil, err
	}
	return flowDefinition, nil
}

// prepareFlowDefinition validates and builds a flow definition without writing.
// userSchema is the schema the flow operates on — callers resolve the handle.
func (fd *flowDefinitionService) prepareFlowDefinition(
	ctx context.Context,
	stmts AllStatements,
	req FlowDefinitionRequest,
	userSchema *domain.JSONSchema,
) (*domain.FlowDefinition, error) {
	purposes, err := mapPurposesToDomain(req.Purposes)
	if err != nil {
		return nil, err
	}
	status, err := domain.FlowDefinitionStatusString(req.Status)
	if err != nil {
		return nil, domain.ErrFlowDefinitionInvalid(fmt.Sprintf("invalid status: %q", req.Status), err)
	}
	if userSchema.ObjectType == nil || *userSchema.ObjectType == "" {
		return nil, domain.ErrFlowDefinitionInvalid(fmt.Sprintf("user schema %q declares no objectType", req.UserSchema), nil)
	}
	flowDefinition, err := domain.NewFlowDefinition(
		"",
		req.ProjectID,
		req.Name,
		req.SchemaVersion,
		*userSchema.ObjectType,
		purposes,
		req.Audience,
		req.Steps,
		status,
	)
	if err != nil {
		return nil, err
	}
	if err := fd.validate(ctx, stmts, flowDefinition, userSchema); err != nil {
		return nil, err
	}
	return flowDefinition, nil
}

// createFlowDefinition inserts a prepared flow definition and emits its event on stmts.
func (fd *flowDefinitionService) createFlowDefinition(ctx context.Context, stmts AllStatements, flowDefinition *domain.FlowDefinition) error {
	if err := stmts.CreateFlowDefinition(ctx, flowDefinition); err != nil {
		return err
	}
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       domain.EventTypeFlowdefCreated,
		Category:   domain.EventCategoryAdmin,
		ProjectID:  flowDefinition.ProjectID,
		EntityType: "flow_definition",
		EntityID:   flowDefinition.ID,
		Payload:    domain.FlowdefPayloadSnapshot(flowDefinition),
	})
}

// resolveOrCreateFlow reuses the project's newest revision of the flow name
// when content matches, otherwise inserts the prepared definition.
func (fd *flowDefinitionService) resolveOrCreateFlow(
	ctx context.Context,
	stmts AllStatements,
	projectID string,
	definition *domain.FlowDefinition,
) (*domain.FlowDefinition, error) {
	latest, err := latestFlowByName(ctx, stmts, projectID, definition.Name)
	if err != nil {
		return nil, err
	}
	if latest != nil && definition.Equal(latest) {
		return latest, nil
	}
	if err := fd.createFlowDefinition(ctx, stmts, definition); err != nil {
		return nil, err
	}
	return definition, nil
}

func latestFlowByName(ctx context.Context, stmts AllStatements, projectID, name string) (*domain.FlowDefinition, error) {
	result, err := stmts.ListFlowDefinitions(WithAuthzListUnrestricted(ctx), &database.ListOptions[domain.FlowDefinitionField]{
		Filter: database.And(
			database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), projectID),
			database.Equal(database.Col(domain.FlowDefinitionFieldName), name),
		),
		Pagination: database.Page[domain.FlowDefinitionField]{Limit: 1},
	}, FlowDefinitionQueryOptions{LatestRevisionPerName: true})
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to list flow definitions")
	}
	if len(result.Items) == 0 {
		return nil, nil
	}
	return result.Items[0], nil
}

func (fd *flowDefinitionService) validate(ctx context.Context, stmts AllStatements, flowDefinition *domain.FlowDefinition, sch *domain.JSONSchema) error {
	userSchema, err := sch.Document()
	if err != nil {
		return domain.ErrSchemaFetchFailed("failed to unmarshal user schema", err)
	}

	pivotingTargets, err := fd.validateFlowDefinition(userSchema, *flowDefinition)
	if err != nil {
		return err
	}

	return fd.validatePivotingTargets(ctx, stmts, pivotingTargets, flowDefinition.ProjectID)
}

func (fd *flowDefinitionService) validatePivotingTargets(ctx context.Context, stmts AllStatements, pivotingTargets []domain.PivotingTarget, projectID string) error {
	if len(pivotingTargets) == 0 {
		return nil
	}
	for _, target := range pivotingTargets {
		defs, err := stmts.ListFlowDefinitions(WithAuthzListUnrestricted(ctx), &database.ListOptions[domain.FlowDefinitionField]{
			Filter: database.And(
				database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), projectID),
				database.Equal(database.Col(domain.FlowDefinitionFieldName), target.Name),
				database.Equal(database.Col(domain.FlowDefinitionFieldStatus), domain.FlowDefinitionStatusActive.String()),
			),
		}, FlowDefinitionQueryOptions{})
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
	// LatestRevisionPerName keeps only the newest revision of each flow name.
	LatestRevisionPerName bool
	Limit                 int
	PageToken             string
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
	cursor, err := revisionsCursor(req.PageToken, req.LatestRevisionPerName)
	if err != nil {
		return nil, err
	}
	opts := &database.ListOptions[domain.FlowDefinitionField]{
		Filter: database.And(filters...),
		Pagination: database.Page[domain.FlowDefinitionField]{
			Limit:  uint32(normalizeLimit(req.Limit)),
			Cursor: cursor,
		},
	}
	result, err := fd.v2Pool.Statements().ListFlowDefinitions(ctx, opts,
		FlowDefinitionQueryOptions{LatestRevisionPerName: req.LatestRevisionPerName})
	if err != nil {
		return nil, mapListError(err, "failed to list flow definitions")
	}
	return &ListFlowDefinitionsResponse{
		Items:         result.Items,
		NextPageToken: stampRevisionsMode(result.NextCursor, req.LatestRevisionPerName),
	}, nil
}
