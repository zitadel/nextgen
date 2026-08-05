// Package flow_definitions embeds the default flow definitions for use by the internal package
package flow_definitions

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	configdefaults "github.com/zitadel/nextgen/packages/config/defaults"
)

func DefaultLoginFlowDefinitions(serverURL string, projectID string, userSchemaURL string) ([]*domain.FlowDefinition, error) {
	bss := [][]byte{configdefaults.DefaultLoginFlowDefinition()}

	defs := make([]*domain.FlowDefinition, len(bss))

	for i, bs := range bss {
		jscontent := string(bs)
		jscontent = strings.ReplaceAll(jscontent, "${SERVER_URL}", serverURL)
		jscontent = strings.ReplaceAll(jscontent, "${USER_SCHEMA_URL}", userSchemaURL)
		jscontent = fmt.Sprintf(
			`{"project_id":%q,"schema_uri":%q,"flow_definition":%s}`,
			projectID,
			configdefaults.DefaultFlowSchemaURI,
			jscontent,
		)

		req := &api.CreateFlowDefinitionRequest{}
		err := req.UnmarshalJSON([]byte(jscontent))
		if err != nil {
			return nil, err
		}

		if err = req.Validate(); err != nil {
			return nil, err
		}

		purposes, err := convertPurposes(req.FlowDefinition.GetPurposes())
		if err != nil {
			return nil, err
		}

		steps, err := convertSteps(req.FlowDefinition.GetSteps())
		if err != nil {
			return nil, err
		}

		status, err := domain.FlowDefinitionStatusString(string(req.FlowDefinition.GetStatus()))
		if err != nil {
			return nil, domain.ErrFlowDefinitionInvalid("invalid status", err)
		}

		defs[i], err = domain.NewFlowDefinition(
			"",
			projectID,
			req.FlowDefinition.GetName(),
			new(url.URL(req.GetSchemaURI().Value)).String(),
			req.FlowDefinition.GetUserSchema(),
			purposes,
			domain.FlowDefinitionAudience{
				AppIDs:  req.FlowDefinition.GetAudience().Value.AppIds,
				TeamIDs: req.FlowDefinition.GetAudience().Value.TeamIds,
			},
			steps,
			status,
		)
		if err != nil {
			return nil, err
		}
	}

	return defs, nil
}

func convertPurposes(purposes api.FlowDefinitionPurposes) (map[domain.FlowDefinitionPurpose]string, error) {
	ret := make(map[domain.FlowDefinitionPurpose]string, len(purposes))
	for purpose, step := range purposes {
		p, err := domain.FlowDefinitionPurposeString(purpose)
		if err != nil {
			return nil, err
		}
		ret[p] = step
	}
	return ret, nil
}

func convertSteps(steps []api.FlowDefinitionStep) ([]domain.FlowDefinitionStep, error) {
	ret := make([]domain.FlowDefinitionStep, len(steps))
	for i, step := range steps {
		gates, err := convertStepGates(step.Gates)
		if err != nil {
			return nil, err
		}

		onSuccess, err := convertOnSuccess(step.GetOnSuccess())
		if err != nil {
			return nil, err
		}

		complete, err := convertComplete(step.GetComplete())
		if err != nil {
			return nil, err
		}

		transitions, err := convertStepTransitions(step.GetTransitions())
		if err != nil {
			return nil, err
		}

		actions, err := convertStepActions(step.GetActions())
		if err != nil {
			return nil, fmt.Errorf("step %q: %w", step.GetName(), err)
		}

		ret[i] = domain.FlowDefinitionStep{
			Name:         step.GetName(),
			Fields:       domain.FieldsFromStrings(step.GetFields()),
			Actions:      actions,
			Gates:        gates,
			SSOProviders: convertStepSSOProviders(step.GetSSOProviders()),
			OnSuccess:    onSuccess,
			Complete:     complete,
			Transitions:  transitions,
		}
	}

	return ret, nil
}

func convertStepTransitions(transitions api.OptFlowDefinitionStepTransitions) (map[string]domain.FlowStepTransition, error) {
	if !transitions.IsSet() {
		return nil, nil
	}

	ret := make(map[string]domain.FlowStepTransition, len(transitions.Value))
	for name, transition := range transitions.Value {
		action, err := convertStepTransitionAction(transition.GetAction())
		if err != nil {
			return nil, err
		}

		ret[name] = domain.FlowStepTransition{
			Action: action,
			Target: transition.GetTarget(),
		}
	}
	return ret, nil
}

func convertStepTransitionAction(action api.OptNilFlowDefinitionStepTransitionsItemAction) (*domain.FlowDefinitionTransitionAction, error) {
	if !action.IsSet() {
		return nil, nil
	}

	ret, err := domain.FlowDefinitionTransitionActionString(string(action.Value))
	if err != nil {
		return nil, err
	}
	return &ret, nil
}

func convertComplete(complete api.OptFlowDefinitionStepComplete) (*domain.FlowStepComplete, error) {
	if !complete.IsSet() {
		return nil, nil
	}

	ret, err := domain.FlowStepCompleteString(string(complete.Value))
	if err != nil {
		return nil, err
	}
	return &ret, nil
}

func convertOnSuccess(success api.OptFlowDefinitionStepOnSuccess) (*domain.FlowOnSuccess, error) {
	if !success.IsSet() {
		return nil, nil
	}

	ret, err := domain.FlowOnSuccessString(string(success.Value))
	if err != nil {
		return nil, err
	}
	return &ret, nil
}

func convertStepSSOProviders(providers []api.SSOProvider) []domain.FlowSSOProvider {
	ret := make([]domain.FlowSSOProvider, len(providers))
	for i, ssoProvider := range providers {
		ret[i] = domain.FlowSSOProvider{
			ID:       ssoProvider.GetID(),
			Name:     ssoProvider.GetName(),
			Template: ssoProvider.GetTemplate(),
		}
	}
	return ret
}

func convertStepGates(gates api.OptFlowDefinitionStepGates) (map[string]domain.FlowStepGate, error) {
	if !gates.IsSet() {
		return nil, nil
	}
	ret := make(map[string]domain.FlowStepGate, len(gates.Value))
	for name, gate := range gates.Value {
		kind, err := domain.FlowGateKindString(string(gate.Kind))
		if err != nil {
			return nil, err
		}

		config, err := convertStepGateConfig(gate.Config)
		if err != nil {
			return nil, err
		}

		ret[name] = domain.FlowStepGate{
			Kind:     kind,
			Provider: gate.GetProvider(),
			Config:   config,
		}
	}
	return ret, nil
}

func convertStepGateConfig(config api.OptGateConfig) (map[string]any, error) {
	if !config.IsSet() {
		return nil, nil
	}
	ret := make(map[string]any, len(config.Value))
	for k, v := range config.Value {
		var val any
		if err := json.Unmarshal(v, &val); err != nil {
			return nil, err
		}
		ret[k] = val
	}
	return ret, nil
}

// convertStepActions preserves the nil-vs-empty distinction so an explicit
// `actions: []` survives the embed-loader path without collapsing into a
// nil that would re-read as "omitted, apply default" downstream.
func convertStepActions(actions []api.StepAction) ([]domain.FlowStepAction, error) {
	if actions == nil {
		return nil, nil
	}

	ret := make([]domain.FlowStepAction, 0, len(actions))
	for _, action := range actions {
		kind, err := domain.FlowActionKindString(string(action.GetKind()))
		if err != nil {
			return nil, fmt.Errorf("action %q: invalid kind %q: %w", action.GetName(), action.GetKind(), err)
		}
		ret = append(ret, domain.FlowStepAction{
			Name:    action.GetName(),
			Kind:    kind,
			TextKey: action.TextKey.Value,
			Primary: action.Primary.Value,
		})
	}

	return ret, nil
}
