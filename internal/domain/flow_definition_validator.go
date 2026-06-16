package domain

import (
	"fmt"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/ianlancetaylor/jsonschema/types"
)

var reservedOutcomes = map[string]struct{}{
	"user_not_found":      {},
	"user_already_exists": {},
	"callback":            {},
}

type PivotingTarget struct {
	Name       string
	Step       string
	Transition string
}

func ValidateFlowDefinition(userSchema *jsonschema.Schema, flowDefinition FlowDefinition) ([]PivotingTarget, error) {
	// 1. validate purpose and initial steps
	if err := validateDefinition(flowDefinition); err != nil {
		return nil, err
	}

	// 2. validate against the fields of the user schema, validate steps, step fields, transitions, actions, etc.
	if err := validateSteps(flowDefinition.Steps, userSchema); err != nil {
		return nil, err
	}

	// 3. validate the graph structure: every step reachable from an initial step, no unreachable steps
	pivotingTargets, err := validateGraph(flowDefinition)
	if err != nil {
		return nil, err
	}

	// 4. validate the cycle of steps: every cycle of steps has at least one exit transition to a terminal step or another flow
	if err := validateCycles(flowDefinition); err != nil {
		return nil, err
	}

	// 5. flip-table coverage + on_success manifest cross-check
	if err := validateFlipTableCoverage(flowDefinition); err != nil {
		return nil, err
	}
	if err := validateOnSuccessManifests(flowDefinition, userSchema); err != nil {
		return nil, err
	}

	return pivotingTargets, nil
}

// validateDefinition checks that the flow definition is valid at a high level:
// - at least one purpose is defined
// - each purpose is a valid enum value
// - each initial step corresponds to a step in the flow definition steps
func validateDefinition(flowDefinition FlowDefinition) error {
	if len(flowDefinition.Purposes) == 0 {
		return ErrFlowDefinitionInvalid("no purposes defined", nil)
	}
	stepNames, err := stepNamesMap(flowDefinition.Steps)
	if err != nil {
		return err
	}
	for purpose, entryStep := range flowDefinition.Purposes {
		// check that the purpose is a valid enum value
		if ok := purpose.IsAFlowDefinitionPurpose(); !ok {
			return ErrFlowDefinitionInvalid(fmt.Sprintf("'%s' is not a valid purpose", purpose), nil)
		}

		// check that the entryStep exists in flowDefinition.Steps
		if entryStep == "" {
			return ErrFlowDefinitionInvalid(fmt.Sprintf("initial step for purpose '%s' is empty", purpose), nil)
		}
		if _, ok := stepNames[entryStep]; !ok {
			return ErrFlowDefinitionInvalid(fmt.Sprintf(
				"purpose %q targets unknown entry-point step %q", purpose, entryStep), nil)
		}
	}
	return nil
}

// validateSteps checks that the flow definition steps are valid
func validateSteps(steps []FlowDefinitionStep, userSchema *jsonschema.Schema) error {
	// extract user schema properties
	userProperties, hasProperties := userSchemaProperties(userSchema)
	if !hasProperties {
		return ErrFlowDefinitionInvalid("user schema has no properties", nil)
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
				return ErrFlowDefinitionInvalid(fmt.Sprintf(
					"step %q is terminal (complete is set) but has fields, actions, transitions, gates, or sso_providers", step.Name), nil)
			}
			continue
		}

		// fields/actions/gates have ordered slice shape on the wire; ensure
		// every entry has a non-empty unique name to keep them addressable by
		// transitions and submit payloads.
		if err := uniqueNonEmptyStrings(step.Name, "field", step.Fields); err != nil {
			return err
		}
		actionNames := make(map[string]struct{}, len(step.Actions))
		for _, a := range step.Actions {
			if a.Name == "" {
				return ErrFlowDefinitionInvalid(fmt.Sprintf(
					"step %q: action has empty name", step.Name), nil)
			}
			if _, dup := actionNames[a.Name]; dup {
				return ErrFlowDefinitionInvalid(fmt.Sprintf(
					"step %q: duplicate action %q", step.Name, a.Name), nil)
			}
			actionNames[a.Name] = struct{}{}
		}

		// a non-terminal step must do something
		_, hasCallback := step.Transitions["callback"]
		if len(step.Fields) == 0 && len(step.Actions) == 0 && len(step.SSOProviders) == 0 &&
			len(step.Gates) == 0 && !hasCallback {
			return ErrFlowDefinitionInvalid(fmt.Sprintf(
				"step %q is non-terminal but has no fields, actions, sso_providers, gates, or transitions.callback", step.Name), nil)
		}

		// when sso_providers is non-empty, transitions.callback must be defined
		if len(step.SSOProviders) > 0 {
			if !hasCallback {
				return ErrFlowDefinitionInvalid(fmt.Sprintf(
					"step %q: has sso_providers but is missing transitions.callback", step.Name), nil)
			}
		}

		// every action must have a matching transition key
		for name := range actionNames {
			if _, ok := step.Transitions[name]; !ok {
				return ErrFlowDefinitionInvalid(fmt.Sprintf(
					"step %q: action %q has no matching transition", step.Name, name), nil)
			}
		}

		// every transition key must be an action name or a reserved outcome
		for transitionKey := range step.Transitions {
			_, isAction := actionNames[transitionKey]
			_, isReserved := reservedOutcomes[transitionKey]
			if !isAction && !isReserved {
				return ErrFlowDefinitionInvalid(fmt.Sprintf(
					"step %q: transition key %q is not an action name or reserved outcome (user_not_found, user_already_exists, callback)", step.Name, transitionKey), nil)
			}
		}

		// todo (grvijayan): a step with an x-identifier field defines a user_not_found transition or return an error
	}
	return nil
}

// uniqueNonEmptyStrings rejects duplicate or empty entries in an ordered
// string list (e.g. step.Fields). Returns a flow-definition-invalid error
// pinned to stepName and a human-readable item label.
func uniqueNonEmptyStrings(stepName, label string, items []string) error {
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		if item == "" {
			return ErrFlowDefinitionInvalid(fmt.Sprintf(
				"step %q: %s entry is empty", stepName, label), nil)
		}
		if _, dup := seen[item]; dup {
			return ErrFlowDefinitionInvalid(fmt.Sprintf(
				"step %q: duplicate %s %q", stepName, label, item), nil)
		}
		seen[item] = struct{}{}
	}
	return nil
}

// validateGraph checks that the flow definition graph is valid:
// - every non-terminal step must have at least one outgoing transition
// - every transition target with no action must be a step in the flow definition
// - every transition target with an action must be an active flow definition in the same project
// - every step must be reachable from some entry point in Purposes
func validateGraph(flowDefinition FlowDefinition) ([]PivotingTarget, error) {
	stepNames, err := stepNamesMap(flowDefinition.Steps)
	if err != nil {
		return nil, err
	}

	var pivotingTargets []PivotingTarget
	// 1. validate all transition targets
	for _, step := range flowDefinition.Steps {
		for key, t := range step.Transitions {
			if t.IsCurrentFlow() {
				// target must be a step in this flow definition
				if _, ok := stepNames[t.Target]; !ok {
					return nil, ErrFlowDefinitionInvalid(fmt.Sprintf(
						"step %q: transition %q targets unknown step %q", step.Name, key, t.Target), nil)
				}
			} else {
				if !t.Action.IsAFlowDefinitionTransitionAction() {
					return nil, ErrFlowDefinitionInvalid(fmt.Sprintf(
						"step %q: transition %q has invalid action %q", step.Name, key, t.Action), nil)
				}
				// switch/pivot: target must be an active flow definition in the same project
				// the service layer must validate that an active flow definition exists with this target name in the same project.
				pivotingTargets = append(pivotingTargets, PivotingTarget{
					Name: t.Target, Step: step.Name, Transition: key,
				})
			}
		}
	}

	// 2. every non-terminal step must have at least one outgoing transition
	for _, step := range flowDefinition.Steps {
		if step.Complete == nil && len(step.Transitions) == 0 {
			return nil, ErrFlowDefinitionInvalid(fmt.Sprintf(
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
			return nil, ErrFlowDefinitionInvalid(fmt.Sprintf(
				"step %q is unreachable from any entry point", name), nil)
		}
	}
	return pivotingTargets, nil
}

// validateCycles ensures that every step can eventually reach a terminal step or exit the flow.
// It assumes that non-terminal steps have at least one outgoing transition (checked in validateGraph).
// This function uses a reverse BFS to find all steps that are reachable from all terminal steps.
// If a step is not reachable from a terminal step, it is trapped.
func validateCycles(flowDefinition FlowDefinition) error {
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
			return ErrFlowDefinitionInvalid(fmt.Sprintf(
				"step %q is trapped: no path to a terminal step or another flow",
				s.Name,
			), nil)
		}
	}
	return nil
}

func isEscapeNode(s FlowDefinitionStep) bool {
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
			return ErrFlowDefinitionInvalid(fmt.Sprintf(
				"step %q: field %q is not a property in the user schema", stepName, field), nil)
		}
	}
	return nil
}

// validateFlipTableCoverage requires the counter-outcome transition on
// an entry step iff the partner purpose is also wired (e.g. login entry
// needs user_not_found only when register is also a purpose).
func validateFlipTableCoverage(def FlowDefinition) error {
	purposes := def.Purposes
	for purpose, entryStepName := range purposes {
		flipTargets, ok := purposeFlipTargets[purpose]
		if !ok {
			continue
		}
		entry, found := def.FindStep(entryStepName)
		if !found {
			continue
		}
		for outcome, targetPurpose := range flipTargets {
			if _, partnerWired := purposes[targetPurpose]; !partnerWired {
				continue
			}
			if _, ok := entry.Transitions[outcome]; !ok {
				return ErrFlowDefinitionInvalid(fmt.Sprintf(
					"step %q: entry step for purpose %q must wire %q transition because %q is also a purpose",
					entry.Name, purpose, outcome, targetPurpose), nil)
			}
		}
	}
	return nil
}

// purposeFlipTargets mirrors the engine's flip table. Kept separate so
// the validator stays pure.
var purposeFlipTargets = map[FlowDefinitionPurpose]map[string]FlowDefinitionPurpose{
	FlowDefinitionPurposeLogin: {
		FlowImplicitOutcomeUserNotFound: FlowDefinitionPurposeRegister,
	},
	FlowDefinitionPurposeRegister: {
		FlowImplicitOutcomeUserAlreadyExists: FlowDefinitionPurposeLogin,
	},
}

// validateOnSuccessManifests verifies that every kind in each step's
// on_success manifest is collected on the step itself or upstream.
func validateOnSuccessManifests(def FlowDefinition, userSchema *jsonschema.Schema) error {
	if len(def.Steps) == 0 {
		return nil
	}
	stepsByName := make(map[string]*FlowDefinitionStep, len(def.Steps))
	for i := range def.Steps {
		stepsByName[def.Steps[i].Name] = &def.Steps[i]
	}
	reverse := make(map[string][]string, len(def.Steps))
	for _, s := range def.Steps {
		for _, t := range s.Transitions {
			if t.IsCurrentFlow() {
				reverse[t.Target] = append(reverse[t.Target], s.Name)
			}
		}
	}

	for i := range def.Steps {
		step := &def.Steps[i]
		if step.OnSuccess == nil {
			continue
		}
		manifest := ManifestForOnSuccess(*step.OnSuccess)
		if manifest == nil {
			continue
		}
		reachable := reachableSteps(step.Name, reverse)
		for _, kind := range manifest {
			if !someStepEstablishesKind(reachable, stepsByName, kind, userSchema) {
				return ErrFlowDefinitionInvalid(fmt.Sprintf(
					"step %q: on_success %s requires %q to be collected upstream", step.Name, *step.OnSuccess, kind), nil)
			}
		}
	}
	return nil
}

// reachableSteps returns `start` plus every ancestor in `reverse`.
func reachableSteps(start string, reverse map[string][]string) map[string]struct{} {
	out := map[string]struct{}{start: {}}
	queue := []string{start}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, pred := range reverse[cur] {
			if _, seen := out[pred]; seen {
				continue
			}
			out[pred] = struct{}{}
			queue = append(queue, pred)
		}
	}
	return out
}

// someStepEstablishesKind reports whether any candidate step collects
// a field whose schema-derived challenge matches kind.
func someStepEstablishesKind(candidates map[string]struct{}, byName map[string]*FlowDefinitionStep, kind FlowFieldChallenge, userSchema *jsonschema.Schema) bool {
	for name := range candidates {
		s, ok := byName[name]
		if !ok {
			continue
		}
		for _, fieldName := range s.Fields {
			if challengeForField(userSchema, fieldName) == kind {
				return true
			}
		}
	}
	return false
}

// challengeForField mirrors [deriveChallenge] in the field resolver.
func challengeForField(userSchema *jsonschema.Schema, fieldName string) FlowFieldChallenge {
	if userSchema == nil {
		return FlowFieldChallengeNone
	}
	properties := lookupProperties(userSchema)
	prop, ok := properties[fieldName]
	if !ok {
		return FlowFieldChallengeNone
	}
	if deriveUnique(prop) != AttributeUniquenessUnspecified {
		return FlowFieldChallengeIdentifier
	}
	if isPassword(prop) && authMethodEnabled(userSchema, "password") {
		return FlowFieldChallengePassword
	}
	return FlowFieldChallengeNone
}

// authMethodEnabled reads `x-auth-methods.<method>.enabled` off the root schema.
func authMethodEnabled(schema *jsonschema.Schema, method string) bool {
	if schema == nil {
		return false
	}
	v, ok := schema.LookupKeyword("x-auth-methods")
	if !ok {
		return false
	}
	raw, ok := v.(types.PartAny)
	if !ok {
		return false
	}
	methods, ok := raw.V.(map[string]any)
	if !ok {
		return false
	}
	entry, ok := methods[method].(map[string]any)
	if !ok {
		return false
	}
	enabled, _ := entry["enabled"].(bool)
	return enabled
}

// a map of step names for a quick lookup of all the steps in a flow definition
// returns an error if there are duplicate step names
func stepNamesMap(steps []FlowDefinitionStep) (map[string]struct{}, error) {
	stepNames := make(map[string]struct{})
	for _, step := range steps {
		if _, exists := stepNames[step.Name]; exists {
			return nil, ErrFlowDefinitionInvalid(fmt.Sprintf("duplicate step name %q", step.Name), nil)
		}
		stepNames[step.Name] = struct{}{}
	}
	return stepNames, nil
}
