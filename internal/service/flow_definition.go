package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/ianlancetaylor/jsonschema/types"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/idgen"
	"github.com/zitadel/nextgen/internal/storage/database"
)

var reservedOutcomes = map[string]struct{}{
	"user_not_found": {},
	"callback":       {},
}

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

type CreateFlowDefinitionRequest struct {
	ProjectID         string
	Name              string
	SchemaVersion     string  // todo: currently empty as the request does not contain schema version
	FlowSchemaURI     url.URL // todo: schema_version (semver) stored in the db vs schema_uri needed for validation
	UserSchema        url.URL
	Purposes          map[domain.FlowDefinitionPurpose]string
	Audience          domain.FlowDefinitionAudience
	Steps             []domain.FlowDefinitionStep
	RawFlowDefinition []byte // todo: is there a better way to do this for validation against the flow definition schema?
}

type flowDefinitionService struct {
	db                    database.Pool
	schemaResolver        SchemaResolver
	builtinSchemaProvider BuiltinSchemaProvider
	flowDefinitionRepo    domain.FlowDefinitionRepository
}

func NewFlowDefinitionService(
	db database.Pool,
	resolver SchemaResolver,
	validator BuiltinSchemaProvider,
	flowDefinitionRepo domain.FlowDefinitionRepository,
) FlowDefinitionService {
	return &flowDefinitionService{
		db:                    db,
		schemaResolver:        resolver,
		builtinSchemaProvider: validator,
		flowDefinitionRepo:    flowDefinitionRepo,
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
		if !errors.Is(err, domain.ErrFlowDefinitionNotFound()) {
			return nil, "", err
		}
	}
	// todo: ideally shouldn't be more than 1
	if len(defs) > 0 {
		return nil, "", domain.ErrFlowDefinitionAlreadyExists()
	}

	ulidGen := idgen.NewULID()
	flowDefID, err := ulidGen.New(string(domain.PrefixFlowDefinition))
	if err != nil {
		return nil, "", domain.ErrInternal(err)
	}

	flowDefinition := domain.FlowDefinition{
		ID:            flowDefID,
		ProjectID:     req.ProjectID,
		Name:          req.Name,
		SchemaVersion: req.SchemaVersion,
		UserSchema:    req.UserSchema,
		Purposes:      req.Purposes,
		Audience:      req.Audience,
		Steps:         req.Steps,
	}
	// if wantFlowSchemaURI is empty, use the latest flow definition schema from the builtin schema provider
	flowSchemaURI := req.FlowSchemaURI.String()
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

	// 2. validate purpose and initial steps
	if err := validateDefinition(flowDefinition); err != nil {
		return err
	}

	// 3. validate against the fields of the user schema, validate steps, step fields, transitions, actions, etc.
	// resolve the user schema from the user schema URI; todo: resolve from cache/db, not via http fetch
	userSchema, err := fd.schemaResolver.Resolve(ctx, fd.db, flowDefinition.ProjectID, flowDefinition.UserSchema.String(), nil)
	if err != nil {
		return domain.ErrSchemaFetchFailed("failed to resolve tenant user schema", err)
	}
	if err := validateSteps(flowDefinition.Steps, userSchema); err != nil {
		return err
	}

	// 4. validate the graph structure: every step reachable from an initial step, no unreachable steps, no cycles, etc.
	if err := validateGraph(ctx, fd.db, fd.flowDefinitionRepo, flowDefinition); err != nil {
		return err
	}

	// 5. validate the cycle of steps, i.e., every cycle of steps has at least one exit transition to a terminal step or another flow
	if err := validateCycles(flowDefinition); err != nil {
		return err
	}

	return nil
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

// validateDefinition checks that the flow definition is valid at a high level:
// - at least one purpose is defined
// - each purpose is a valid enum value
// - each initial step corresponds to a step in the flow definition steps
func validateDefinition(flowDefinition domain.FlowDefinition) error {
	if len(flowDefinition.Purposes) == 0 {
		return domain.ErrFlowDefinitionInvalid("no purposes defined", nil)
	}
	stepNames, err := stepNamesMap(flowDefinition.Steps)
	if err != nil {
		return err
	}
	for purpose, entryStep := range flowDefinition.Purposes {
		// check that the purpose is a valid enum value
		if ok := purpose.IsAFlowDefinitionPurpose(); !ok {
			return domain.ErrFlowDefinitionInvalid(fmt.Sprintf("'%s' is not a valid purpose", purpose), nil)
		}

		// check that the entryStep exists in flowDefinition.Steps
		if entryStep == "" {
			return domain.ErrFlowDefinitionInvalid(fmt.Sprintf("initial step for purpose '%s' is empty", purpose), nil)
		}
		if _, ok := stepNames[entryStep]; !ok {
			return domain.ErrFlowDefinitionInvalid(fmt.Sprintf(
				"purpose %q targets unknown entry-point step %q", purpose, entryStep), nil)
		}
	}
	return nil
}

// validateSteps checks that the flow definition steps are valid
func validateSteps(steps []domain.FlowDefinitionStep, userSchema *jsonschema.Schema) error {
	// extract user schema properties
	userProperties, hasProperties := userSchemaProperties(userSchema)
	if !hasProperties {
		return domain.ErrFlowDefinitionInvalid("user schema has no properties", nil)
	}
	for _, step := range steps {
		err := stepFieldsInUserSchema(step.Name, step.Fields, userProperties)
		if err != nil {
			return err
		}

		isTerminalStep := step.Complete != nil
		// a terminal step must have no fields/actions/transitions/gates/sso_providers
		if isTerminalStep {
			if len(step.Fields) > 0 || len(step.Actions) > 0 || len(step.Transitions) > 0 ||
				len(step.Gates) > 0 || len(step.SSOProviders) > 0 {
				return domain.ErrFlowDefinitionInvalid(fmt.Sprintf(
					"step %q is terminal (complete is set) but has fields, actions, transitions, gates, or sso_providers", step.Name), nil)
			}
			continue
		}

		// a non-terminal step must do something
		_, hasCallback := step.Transitions["callback"]
		if len(step.Fields) == 0 && len(step.Actions) == 0 && len(step.SSOProviders) == 0 &&
			len(step.Gates) == 0 && !hasCallback {
			return domain.ErrFlowDefinitionInvalid(fmt.Sprintf(
				"step %q is non-terminal but has no fields, actions, sso_providers, gates, or transitions.callback", step.Name), nil)
		}

		// when sso_providers is non-empty, transitions.callback must be defined
		if len(step.SSOProviders) > 0 {
			if !hasCallback {
				return domain.ErrFlowDefinitionInvalid(fmt.Sprintf(
					"step %q: has sso_providers but is missing transitions.callback", step.Name), nil)
			}
		}

		// every action key must have a matching transition key
		for actionName := range step.Actions {
			if _, ok := step.Transitions[actionName]; !ok {
				return domain.ErrFlowDefinitionInvalid(fmt.Sprintf(
					"step %q: action %q has no matching transition", step.Name, actionName), nil)
			}
		}

		// every transition key must be an action name or a reserved outcome
		for transitionKey := range step.Transitions {
			_, isAction := step.Actions[transitionKey]
			_, isReserved := reservedOutcomes[transitionKey]
			if !isAction && !isReserved {
				return domain.ErrFlowDefinitionInvalid(fmt.Sprintf(
					"step %q: transition key %q is not an action name or reserved outcome (user_not_found, callback)", step.Name, transitionKey), nil)
			}
		}

		// todo: a step with an x-identifier field defines a user_not_found transition or return an error
	}
	return nil
}

// validateGraph checks that the flow definition graph is valid:
// - every non-terminal step must have at least one outgoing transition
// - every transition target with no action must be a step in the flow definition
// - every transition target with an action must be an active flow definition in the same project
// - every step must be reachable from some entry point in Purposes
func validateGraph(ctx context.Context, db database.QueryExecutor, repo domain.FlowDefinitionRepository, flowDefinition domain.FlowDefinition) error {
	stepNames, err := stepNamesMap(flowDefinition.Steps)
	if err != nil {
		return err
	}

	// 1. validate all transition targets
	for _, step := range flowDefinition.Steps {
		for key, t := range step.Transitions {
			if t.IsCurrentFlow() {
				// target must be a step in this flow definition
				if _, ok := stepNames[t.Target]; !ok {
					return domain.ErrFlowDefinitionInvalid(fmt.Sprintf(
						"step %q: transition %q targets unknown step %q", step.Name, key, t.Target), nil)
				}
			} else {
				// switch/pivot: target must be an active flow definition in the same project
				defs, err := repo.ListFlowDefinitions(ctx, db, flowDefinition.ProjectID,
					domain.WithFlowDefinitionName(t.Target),
					domain.WithFlowDefinitionStatus(domain.FlowDefinitionStatusActive),
				)
				if err != nil {
					return err
				}
				if len(defs) == 0 {
					return domain.ErrFlowDefinitionInvalid(fmt.Sprintf(
						"step %q: transition %q targets unknown or inactive flow %q", step.Name, key, t.Target), nil)
				}
			}
		}
	}

	// 2. every non-terminal step must have at least one outgoing transition
	for _, step := range flowDefinition.Steps {
		if step.Complete == nil && len(step.Transitions) == 0 {
			return domain.ErrFlowDefinitionInvalid(fmt.Sprintf(
				"step %q is non-terminal but has no outgoing transitions", step.Name), nil)
		}
	}

	// 3. reachability: every step must be reachable from some entry point in Purposes
	reachable := make(map[string]struct{})
	// adjacency map: step name -> list of target step names for all current-flow transitions
	adj := make(map[string][]string, len(flowDefinition.Steps))
	for _, s := range flowDefinition.Steps {
		for _, t := range s.Transitions {
			if t.IsCurrentFlow() {
				adj[s.Name] = append(adj[s.Name], t.Target)
			}
		}
	}
	for _, entryStep := range flowDefinition.Purposes {
		bfsReachable(entryStep, adj, reachable)
	}
	for name := range stepNames {
		if _, ok := reachable[name]; !ok {
			return domain.ErrFlowDefinitionInvalid(fmt.Sprintf(
				"step %q is unreachable from any entry point", name), nil)
		}
	}
	return nil
}

// validateCycles ensures that every step can eventually reach a terminal step or exit the flow.
// It assumes that non-terminal steps have at least one outgoing transition (checked in validateGraph).
// This function uses a reverse BFS to find all steps that are reachable from all terminal steps.
// If a step is not reachable from a terminal step, it is trapped.
func validateCycles(flowDefinition domain.FlowDefinition) error {
	// Reverse adjacency over local transitions only
	reverseAdj := make(map[string][]string, len(flowDefinition.Steps))
	for _, s := range flowDefinition.Steps {
		for _, t := range s.Transitions {
			if t.IsCurrentFlow() {
				reverseAdj[t.Target] = append(reverseAdj[t.Target], s.Name)
			}
		}
	}

	// Seed: nodes that are themselves escapes
	safe := make(map[string]struct{}, len(flowDefinition.Steps))
	var queue []string
	for _, s := range flowDefinition.Steps {
		if isEscapeNode(s) {
			safe[s.Name] = struct{}{}
			queue = append(queue, s.Name)
		}
	}

	// BFS backwards: if you can reach an escape node, you're safe
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, pred := range reverseAdj[cur] {
			if _, already := safe[pred]; !already {
				safe[pred] = struct{}{}
				queue = append(queue, pred)
			}
		}
	}

	// Any step not marked safe is trapped
	for _, s := range flowDefinition.Steps {
		if s.Complete != nil {
			continue // terminal steps don't need an escape
		}
		if _, ok := safe[s.Name]; !ok {
			return domain.ErrFlowDefinitionInvalid(fmt.Sprintf(
				"step %q is trapped: no path to a terminal step or another flow",
				s.Name,
			), nil)
		}
	}
	return nil
}

func isEscapeNode(s domain.FlowDefinitionStep) bool {
	if s.Complete != nil {
		return true // is a terminal step, so escape via completion
	}
	for _, t := range s.Transitions {
		if !t.IsCurrentFlow() {
			return true // has a switch/pivot out
		}
	}
	return false
}

// bfsReachable does a BFS from start over local (IsCurrentFlow) transitions,
// accumulating visited step names into reachable.
func bfsReachable(start string, adj map[string][]string, reachable map[string]struct{}) {
	queue := []string{start}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		if _, visited := reachable[cur]; visited {
			continue
		}
		reachable[cur] = struct{}{}
		queue = append(queue, adj[cur]...)
	}
}

// userSchemaProperties extracts the "properties" map from a compiled user schema.
// Returns (map, true) when the keyword is present, (nil, false) otherwise.
func userSchemaProperties(userSchema *jsonschema.Schema) (types.PartMapSchema, bool) {
	pv, ok := userSchema.LookupKeyword("properties")
	if !ok {
		return nil, false
	}
	props, ok := pv.(types.PartMapSchema)
	return props, ok
}

// stepFieldsInUserSchema checks that all fields in a step are defined in the user schema properties
func stepFieldsInUserSchema(stepName string, stepFields []string, userProperties types.PartMapSchema) error {
	for _, field := range stepFields {
		if _, ok := userProperties[field]; !ok {
			return domain.ErrFlowDefinitionInvalid(fmt.Sprintf(
				"step %q: field %q is not a property in the user schema", stepName, field), nil)
		}
	}
	return nil
}

// a map of step names for a quick lookup of all the steps in a flow definition
// returns an error if there are duplicate step names
func stepNamesMap(steps []domain.FlowDefinitionStep) (map[string]struct{}, error) {
	stepNames := make(map[string]struct{})
	for _, step := range steps {
		if _, exists := stepNames[step.Name]; exists {
			return nil, domain.ErrFlowDefinitionInvalid(fmt.Sprintf("duplicate step name %q", step.Name), nil)
		}
		stepNames[step.Name] = struct{}{}
	}
	return stepNames, nil
}
