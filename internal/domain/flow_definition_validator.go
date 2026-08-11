package domain

import (
	"fmt"
	"slices"

	"github.com/ianlancetaylor/jsonschema"
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

// ValidateFlowDefinition is ported (rules and message strings) to
// packages/config/src/validate.ts for CLI plan-time validation — keep
// rule changes in sync; a drift-audit test over this file guards the
// function names and shared literals. The sync burden is interim: the
// validate-only bundle endpoint (zitadel/nextgen#449) supersedes the
// port, and the TS side is deleted when it lands.
func ValidateFlowDefinition(userSchema *jsonschema.Schema, flowDefinition FlowDefinition) ([]PivotingTarget, error) {
	// 1. validate purpose and initial steps
	if err := validateDefinition(flowDefinition); err != nil {
		return nil, err
	}

	// 2. validate steps, step fields, transitions, actions, etc.
	if err := validateSteps(flowDefinition.Steps); err != nil {
		return nil, err
	}

	// 3. resolve each step's fields against the user schema.
	resolvedByStep, err := resolveAllStepFields(userSchema, flowDefinition.Steps)
	if err != nil {
		return nil, err
	}

	// 3b. passkey is action-shaped, not field-shaped, so the per-field
	// enabled-method cross-check above never sees it.
	if err := validatePasskeyActionsEnabled(newSchemaReader(userSchema), flowDefinition.Steps); err != nil {
		return nil, err
	}

	// 4. validate the graph structure: every step reachable from an initial step, no unreachable steps
	pivotingTargets, err := validateGraph(flowDefinition)
	if err != nil {
		return nil, err
	}

	// 5. validate the cycle of steps: every cycle of steps has at least one exit transition to a terminal step or another flow
	if err := validateCycles(flowDefinition); err != nil {
		return nil, err
	}

	// 6. flip-table coverage + on_success manifest cross-check
	if err := validateFlipTableCoverage(flowDefinition); err != nil {
		return nil, err
	}
	if err := validateOnSuccessManifests(flowDefinition, resolvedByStep); err != nil {
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

// resolveAllStepFields runs every step's fields through the resolver
// and returns the per-step results keyed by step name. Resolution
// errors (unknown property, unsupported type, etc.) are translated to
// definition-validation errors. An `x-auth-methods#<method>` field
// whose method is not enabled on the schema is rejected.
func resolveAllStepFields(schema *jsonschema.Schema, steps []FlowDefinitionStep) (map[string]FlowResolvedFields, error) {
	// Fail fast on schemas with no `properties` keyword at all. Without
	// it the resolver would emit one ErrFlowFieldUnknown per user-property
	// field; the structural defect is clearer surfaced once.
	sr := newSchemaReader(schema)
	if sr.Properties() == nil {
		return nil, ErrFlowDefinitionInvalid("user schema has no properties", nil)
	}

	// validate that all required fields in the schema are present in the flow definition
	if err := validateRequiredUserSchemaFields(sr.RequiredSet(), steps); err != nil {
		return nil, err
	}

	// SchemaFieldResolver is stateless; a zero-value instance is the
	// shared translator used at both runtime (state machine) and
	// definition-time (this validator).
	var resolver SchemaFieldResolver

	out := make(map[string]FlowResolvedFields, len(steps))
	for _, step := range steps {
		resolved, err := resolver.Resolve(schema, step.Name, step.Fields)
		if err != nil {
			return nil, ErrFlowDefinitionInvalid(fmt.Sprintf(
				"step %q: %v", step.Name, err), nil)
		}
		for _, f := range resolved.Fields {
			raw := Field(f.Name)
			if raw.IsAuthMethod() && f.Challenge == FlowFieldChallengeNone {
				return nil, ErrFlowDefinitionInvalid(fmt.Sprintf(
					"step %q: %q is not an enabled authentication method",
					step.Name, raw.AuthMethod()), nil)
			}
		}
		out[step.Name] = resolved
	}
	return out, nil
}

// validatePasskeyActionsEnabled rejects any step declaring a `passkey`
// or `passkey_register` action when the user schema's `x-auth-methods`
// does not enable passkey — the action-shaped counterpart of the
// enabled-method check [resolveAllStepFields] applies to the
// `x-auth-methods#password` field. An absent keyword counts as
// disabled, matching [xAuthMethodsReader.IsEnabled].
//
// Definition time is the only enforcement point, like every rule in
// this file: a flow pins its schema revision by URL (schema edits mint
// a new revision; repinning a flow re-validates it), so a validated
// flow's verdict cannot change at runtime and the state machine trusts
// it. Flows applied before this rule surface the violation on their
// next plan/apply.
func validatePasskeyActionsEnabled(sr schemaReader, steps []FlowDefinitionStep) error {
	authMethods, err := sr.AuthMethods()
	if err != nil {
		return ErrFlowDefinitionInvalid(fmt.Sprintf("user schema: %v", err), nil)
	}
	if authMethods.IsEnabled("passkey") {
		return nil
	}
	for _, step := range steps {
		for _, a := range step.Actions {
			if a.Kind == FlowActionKindPasskey || a.Kind == FlowActionKindPasskeyRegister {
				return ErrFlowDefinitionInvalid(fmt.Sprintf(
					`step %q: action %q offers passkey but "passkey" is not an enabled authentication method`,
					step.Name, a.Name), nil)
			}
		}
	}
	return nil
}

// validateRequiredUserSchemaFields checks that all required fields in the
// user schema are present in the flow definition.
func validateRequiredUserSchemaFields(required map[string]struct{}, steps []FlowDefinitionStep) error {
	if len(required) == 0 {
		return nil
	}
	// gather all the fields set in the flow definition steps
	fields := make(map[string]struct{})
	for _, step := range steps {
		for _, f := range step.Fields {
			fields[string(f)] = struct{}{}
		}
	}
	missingFields := make([]string, 0, len(required))
	for requiredField := range required {
		if _, ok := fields[requiredField]; !ok {
			missingFields = append(missingFields, requiredField)
		}
	}
	if len(missingFields) > 0 {
		slices.Sort(missingFields)
		return ErrFlowDefinitionInvalid(fmt.Sprintf("required fields %v in user schema are missing in the flow definition steps", missingFields), nil)
	}
	return nil
}

// validateSteps checks the structural shape of each step (terminal vs
// non-terminal, unique field/action names, transitions matching
// actions or reserved outcomes). Field-name validity against the user
// schema is checked upstream by [resolveAllStepFields].
func validateSteps(steps []FlowDefinitionStep) error {
	for _, step := range steps {
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
		if err := uniqueNonEmptyFields(step.Name, step.Fields); err != nil {
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
			if a.Kind == FlowActionKindUnset || !a.Kind.IsAFlowActionKind() {
				return ErrFlowDefinitionInvalid(fmt.Sprintf(
					"step %q: action %q has no kind", step.Name, a.Name), nil)
			}
			if a.Kind == FlowActionKindBack {
				return ErrFlowDefinitionInvalid(fmt.Sprintf(
					"step %q: action %q has kind=back, which is engine-injected and cannot be declared", step.Name, a.Name), nil)
			}
			if a.Name == flowBackActionName {
				return ErrFlowDefinitionInvalid(fmt.Sprintf(
					"step %q: action name %q is reserved for engine-injected back navigation", step.Name, a.Name), nil)
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

		// todo (grvijayan): a step with an identifier field (a property carrying
		// a non-empty x-unique scope) defines a user_not_found transition or return an error
	}
	return nil
}

// uniqueNonEmptyFields rejects duplicate or empty entries in a step's
// Fields list. Returns a flow-definition-invalid error pinned to
// stepName.
func uniqueNonEmptyFields(stepName string, items []Field) error {
	seen := make(map[Field]struct{}, len(items))
	for _, item := range items {
		if item == "" {
			return ErrFlowDefinitionInvalid(fmt.Sprintf(
				"step %q: field entry is empty", stepName), nil)
		}
		if _, dup := seen[item]; dup {
			return ErrFlowDefinitionInvalid(fmt.Sprintf(
				"step %q: duplicate field %q", stepName, item), nil)
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
					"step %q: entry step for purpose %q must wire %q transition because %q is also a purpose: without it, %s",
					entry.Name, purpose, outcome, targetPurpose, flipOutcomeImpacts[outcome]), nil)
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

// flipOutcomeImpacts spells out, per implicit outcome, who gets stuck
// where when the entry step leaves it unwired — the flip-table violation
// explains the user impact, not just the graph rule. Mirrored verbatim
// in packages/config/src/validate.ts (drift-audited there).
var flipOutcomeImpacts = map[string]string{
	FlowImplicitOutcomeUserNotFound:      "someone without an account gets stuck at sign-in instead of being routed to registration",
	FlowImplicitOutcomeUserAlreadyExists: "someone who already has an account gets stuck at registration instead of being routed to sign-in",
}

// validateOnSuccessManifests verifies that every kind in each step's
// on_success manifest is collected on the step itself or upstream.
func validateOnSuccessManifests(def FlowDefinition, resolvedByStep map[string]FlowResolvedFields) error {
	if len(def.Steps) == 0 {
		return nil
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
			if !someStepEstablishesKind(reachable, resolvedByStep, kind) {
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
// a field whose resolver-derived challenge matches kind.
func someStepEstablishesKind(candidates map[string]struct{}, resolvedByStep map[string]FlowResolvedFields, kind FlowFieldChallenge) bool {
	for name := range candidates {
		resolved, ok := resolvedByStep[name]
		if !ok {
			continue
		}
		for _, f := range resolved.Fields {
			if f.Challenge == kind {
				return true
			}
		}
	}
	return false
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
