package flow_definitions

import (
	"encoding/json"
	"fmt"
	"slices"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// AudienceFromAPI maps a wire flow audience to the domain's; an absent one
// restricts nothing.
func AudienceFromAPI(audience api.OptFlowAudience) domain.FlowDefinitionAudience {
	return domain.FlowDefinitionAudience{
		AppIDs:  audience.Value.AppIds,
		TeamIDs: audience.Value.TeamIds,
	}
}

// StepsFromAPI maps wire flow definition steps to the domain's. A value the
// domain does not know is refused with flowdef.invalid, never defaulted.
func StepsFromAPI(steps []api.FlowDefinitionStep) ([]domain.FlowDefinitionStep, error) {
	out := make([]domain.FlowDefinitionStep, len(steps))
	for i, step := range steps {
		converted, err := stepFromAPI(step)
		if err != nil {
			return nil, domain.ErrFlowDefinitionInvalid(fmt.Sprintf("step %q: %s", step.GetName(), err), nil)
		}
		out[i] = converted
	}
	return out, nil
}

func stepFromAPI(step api.FlowDefinitionStep) (domain.FlowDefinitionStep, error) {
	actions, err := actionsFromAPI(step.GetActions())
	if err != nil {
		return domain.FlowDefinitionStep{}, err
	}
	gates, err := gatesFromAPI(step.GetGates())
	if err != nil {
		return domain.FlowDefinitionStep{}, err
	}
	transitions, err := transitionsFromAPI(step.GetTransitions())
	if err != nil {
		return domain.FlowDefinitionStep{}, err
	}
	out := domain.FlowDefinitionStep{
		Name:         step.GetName(),
		Fields:       domain.FieldsFromStrings(step.GetFields()),
		Actions:      actions,
		Gates:        gates,
		SSOProviders: slices.Clone(step.GetSSOProviders()),
		Transitions:  transitions,
	}
	if value, ok := step.GetOnSuccess().Get(); ok {
		onSuccess, err := domain.FlowOnSuccessString(string(value))
		if err != nil {
			return domain.FlowDefinitionStep{}, fmt.Errorf("invalid on_success %q", value)
		}
		out.OnSuccess = &onSuccess
	}
	if value, ok := step.GetComplete().Get(); ok {
		complete, err := domain.FlowStepCompleteString(string(value))
		if err != nil {
			return domain.FlowDefinitionStep{}, fmt.Errorf("invalid complete %q", value)
		}
		out.Complete = &complete
	}
	return out, nil
}

// actionsFromAPI keeps an omitted list nil and an explicit `[]` empty.
func actionsFromAPI(actions []api.StepAction) ([]domain.FlowStepAction, error) {
	if actions == nil {
		return nil, nil
	}
	out := make([]domain.FlowStepAction, 0, len(actions))
	for _, action := range actions {
		kind, err := domain.FlowActionKindString(string(action.GetKind()))
		if err != nil {
			return nil, fmt.Errorf("action %q has invalid kind %q", action.GetName(), action.GetKind())
		}
		out = append(out, domain.FlowStepAction{
			Name:    action.GetName(),
			Kind:    kind,
			Primary: action.GetPrimary().Value,
			TextKey: action.GetTextKey().Value,
		})
	}
	return out, nil
}

// gatesFromAPI keeps an absent config nil, as storage reads it back.
func gatesFromAPI(gates api.OptFlowDefinitionStepGates) (map[string]domain.FlowStepGate, error) {
	value, ok := gates.Get()
	if !ok {
		return nil, nil
	}
	out := make(map[string]domain.FlowStepGate, len(value))
	for name, gate := range value {
		kind, err := domain.FlowGateKindString(string(gate.GetKind()))
		if err != nil {
			return nil, fmt.Errorf("gate %q has invalid kind %q", name, gate.GetKind())
		}
		var config map[string]any
		if raw, ok := gate.GetConfig().Get(); ok {
			config = make(map[string]any, len(raw))
			for key, encoded := range raw {
				var decoded any
				if err := json.Unmarshal(encoded, &decoded); err != nil {
					return nil, fmt.Errorf("gate %q has invalid config %q", name, key)
				}
				config[key] = decoded
			}
		}
		out[name] = domain.FlowStepGate{
			Kind:     kind,
			Provider: gate.GetProvider(),
			Config:   config,
		}
	}
	return out, nil
}

// transitionsFromAPI maps an explicit `null` action or purpose like an
// absent one: Get is false for both.
func transitionsFromAPI(transitions api.OptFlowDefinitionStepTransitions) (map[string]domain.FlowStepTransition, error) {
	value, ok := transitions.Get()
	if !ok {
		return nil, nil
	}
	out := make(map[string]domain.FlowStepTransition, len(value))
	for name, transition := range value {
		converted := domain.FlowStepTransition{Target: transition.GetTarget().Or("")}
		if wireAction, ok := transition.GetAction().Get(); ok {
			action, err := domain.FlowDefinitionTransitionActionString(string(wireAction))
			if err != nil {
				return nil, fmt.Errorf("transition %q has invalid action %q", name, wireAction)
			}
			converted.Action = &action
		}
		if wirePurpose, ok := transition.GetPurpose().Get(); ok {
			purpose, err := domain.FlowDefinitionPurposeString(string(wirePurpose))
			if err != nil {
				return nil, fmt.Errorf("transition %q has invalid purpose %q", name, wirePurpose)
			}
			converted.Purpose = &purpose
		}
		out[name] = converted
	}
	return out, nil
}
