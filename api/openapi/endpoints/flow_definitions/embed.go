// Package flow_definitions embeds the default flow definitions for use by the internal package
package flow_definitions

import (
	_ "embed"
	"encoding/json"
	"net/url"
	"strings"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

//go:embed examples/default-login-flow-definition.json
var defaultLoginFlowDefinition []byte

func DefaultLoginFlowDefinition(serverURL string, projectID string) (*domain.FlowDefinition, error) {
	jscontent := string(defaultLoginFlowDefinition)
	jscontent = strings.ReplaceAll(jscontent, "${PROJECT_ID}", projectID)
	jscontent = strings.ReplaceAll(jscontent, "${SERVER_URL}", serverURL)

	req := &api.CreateFlowDefinitionRequest{}
	err := req.UnmarshalJSON([]byte(jscontent))

	if err = req.Validate(); err != nil {
		return nil, err
	}

	purposes, err := convertPurposes(req.FlowDefinition.GetPurposes())
	if err != nil {
		return nil, err
	}

	steps, err := convertSteps(req.FlowDefinition.GetSteps())

	return domain.NewFlowDefinition(
		projectID,
		req.FlowDefinition.GetName(),
		new(url.URL(req.GetSchemaURI().Value)).String(),
		new(req.FlowDefinition.GetUserSchema()).String(),
		purposes,
		domain.FlowDefinitionAudience{
			AppIDs:  req.FlowDefinition.GetAudience().Value.AppIds,
			TeamIDs: req.FlowDefinition.GetAudience().Value.TeamIds,
		},
		steps,
	)
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

		onSuccess, err := convertSOnSuccess(step.GetOnSuccess())
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

		ret[i] = domain.FlowDefinitionStep{
			Name:         step.GetName(),
			Fields:       step.GetFields(),
			Actions:      convertStepActions(step.GetActions()),
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
	if action.IsSet() {
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

func convertSOnSuccess(success api.OptFlowDefinitionStepOnSuccess) (*domain.FlowOnSuccess, error) {
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

func convertStepActions(actions api.OptFlowDefinitionStepActions) map[string]domain.FlowStepAction {
	if !actions.IsSet() {
		return nil
	}

	ret := make(map[string]domain.FlowStepAction, len(actions.Value))
	for name, action := range actions.Value {
		ret[name] = domain.FlowStepAction{
			TextKey: action.TextKey.Value,
			Primary: action.Primary.Value,
		}
	}

	return ret
}
