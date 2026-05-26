package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"

	"github.com/muhlemmer/gu"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h Handler) CreateFlowDefinition(ctx context.Context, req *api.CreateFlowDefinitionRequest) (api.CreateFlowDefinitionRes, error) {
	svcReq, err := mapCreateRequestToService(req)
	if err != nil {
		return &api.CreateFlowDefinitionBadRequest{
			Code:    "invalid_flow_definition",
			Message: "invalid flow definition",
		}, nil
	}

	create, flowSchemaURI, err := h.flowDefinitionService.Create(ctx, svcReq)
	if err != nil {
		return errorResponse(err), nil // todo (grvijayan): review
	}

	return flowDefinitionSuccessResponse(create, flowSchemaURI), nil
}

func mapCreateRequestToService(req *api.CreateFlowDefinitionRequest) (service.CreateFlowDefinitionRequest, error) {
	definition := req.GetFlowDefinition()

	userSchemaURI := definition.GetUserSchema()
	svcReq := service.CreateFlowDefinitionRequest{
		ProjectID:     string(req.GetProjectID()),
		Name:          definition.GetName(),
		UserSchema:    userSchemaURI.String(),
		SchemaVersion: "1.0.0.", // todo (grvijayan): find a way to set this based on the schema URI or the request (currently not set in the request)
	}

	rawFlowDefinition, err := definition.MarshalJSON()
	if err != nil {
		return svcReq, fmt.Errorf("failed to marshal flow definition: %w", err)
	}
	svcReq.RawFlowDefinition = rawFlowDefinition

	purposes := make(map[string]string, len(definition.GetPurposes()))
	for purpose, entryStep := range definition.GetPurposes() {
		purposes[purpose] = entryStep
	}
	svcReq.Purposes = purposes

	reqFlowSchemaURI, ok := req.GetSchemaURI().Get()
	if ok {
		u := (url.URL)(reqFlowSchemaURI)
		svcReq.FlowSchemaURI = u.String()
	}

	if reqAudience, ok := definition.GetAudience().Get(); ok {
		svcReq.Audience = domain.FlowDefinitionAudience{
			AppIDs:  reqAudience.GetAppIds(),
			TeamIDs: reqAudience.GetTeamIds(),
		}
	}

	// map steps to domain
	steps := make([]domain.FlowDefinitionStep, 0, len(definition.GetSteps()))
	for _, step := range definition.GetSteps() {
		s := domain.FlowDefinitionStep{
			Name:   step.GetName(),
			Fields: step.GetFields(),
		}
		// actions
		if step.GetActions().IsSet() {
			actions := make(map[string]domain.FlowStepAction, len(step.GetActions().Value))
			for name, apiAction := range step.GetActions().Value {
				actions[name] = domain.FlowStepAction{
					Primary: apiAction.GetPrimary().Value,
					TextKey: apiAction.GetTextKey().Value,
				}
			}
			s.Actions = actions
		}

		// gates
		if step.GetGates().IsSet() {
			gates := make(map[string]domain.FlowStepGate, len(step.GetGates().Value))
			for name, apiGate := range step.GetGates().Value {
				kind, _ := domain.FlowGateKindString(string(apiGate.GetKind())) // todo (grvijayan): validate in the domain layer

				cfg := make(map[string]any, len(apiGate.GetConfig().Value))
				for k, v := range apiGate.GetConfig().Value {
					var val any
					if err := json.Unmarshal(v, &val); err == nil {
						cfg[k] = val
					}
				}
				gates[name] = domain.FlowStepGate{
					Kind:     kind,
					Provider: apiGate.GetProvider(),
					Config:   cfg,
				}
			}
			s.Gates = gates
		}

		// sso providers
		ssoProviders := make([]domain.FlowSSOProvider, 0, len(step.GetSSOProviders()))
		for _, ssoProvider := range step.GetSSOProviders() {
			s := domain.FlowSSOProvider{
				ID:       ssoProvider.GetID(),
				Name:     ssoProvider.GetName(),
				Template: ssoProvider.GetTemplate(),
			}
			ssoProviders = append(ssoProviders, s)
		}
		s.SSOProviders = ssoProviders

		// transitions
		if step.GetTransitions().IsSet() {
			transitions := make(map[string]domain.FlowStepTransition, len(step.GetTransitions().Value))
			for name, apiTransition := range step.GetTransitions().Value {
				var transitionAction *domain.FlowDefinitionTransitionAction
				if apiTransition.Action.IsSet() {
					a, _ := domain.FlowDefinitionTransitionActionString(string(apiTransition.GetAction().Value)) // validated in the domain
					transitionAction = &a
				}

				t := domain.FlowStepTransition{
					Action: transitionAction,
					Target: apiTransition.GetTarget(),
				}
				transitions[name] = t
			}
			s.Transitions = transitions
		}

		// complete
		if step.GetComplete().IsSet() {
			complete, _ := domain.FlowStepCompleteString(string(step.GetComplete().Value))
			s.Complete = &complete
		}

		// on_success
		if onSuccess, ok := step.GetOnSuccess().Get(); ok {
			parsed, err := domain.FlowOnSuccessString(string(onSuccess))
			if err != nil {
				return svcReq, fmt.Errorf("step %q: invalid on_success %q: %w", step.GetName(), onSuccess, err)
			}
			s.OnSuccess = &parsed
		}

		steps = append(steps, s)
	}
	svcReq.Steps = steps
	return svcReq, nil
}

func flowDefinitionSuccessResponse(flowDefinition *domain.FlowDefinition, schemaURI string) *api.FlowDefinitionDetailResponse {
	purposes := mapDomainPurposesToAPI(flowDefinition.Purposes)
	audience := api.OptFlowAudience{
		Value: api.FlowAudience{
			TeamIds: flowDefinition.Audience.TeamIDs,
			AppIds:  flowDefinition.Audience.AppIDs,
		},
		Set: true,
	}
	steps := mapDomainStepsToAPI(flowDefinition.Steps)

	parsedSchemaURI, _ := url.Parse(schemaURI)
	userSchemaURI, _ := url.Parse(flowDefinition.UserSchema)

	return &api.FlowDefinitionDetailResponse{
		Name:       flowDefinition.Name,
		UserSchema: gu.Value(userSchemaURI),
		Purposes:   purposes,
		Audience:   audience,
		Steps:      steps,
		ID:         flowDefinition.ID,
		ProjectID:  flowDefinition.ProjectID,
		SchemaURI:  gu.Value(parsedSchemaURI),
		Status:     flowDefinition.Status.String(),
		CreatedAt:  flowDefinition.CreatedAt,
		UpdatedAt:  flowDefinition.UpdatedAt,
	}
}

func mapDomainPurposesToAPI(domainPurposes map[domain.FlowDefinitionPurpose]string) api.FlowDefinitionDetailResponsePurposes {
	purposes := make(api.FlowDefinitionDetailResponsePurposes, len(domainPurposes))
	for purpose, entry := range domainPurposes {
		purposes[purpose.String()] = entry
	}
	return purposes
}

func mapDomainStepsToAPI(domainSteps []domain.FlowDefinitionStep) []api.FlowDefinitionStep {
	steps := make([]api.FlowDefinitionStep, 0, len(domainSteps))
	for _, step := range domainSteps {
		// actions
		actions := make(map[string]api.StepAction, len(step.Actions))
		for name, action := range step.Actions {
			actions[name] = api.StepAction{
				Primary: api.NewOptBool(action.Primary),
				TextKey: api.NewOptString(action.TextKey),
			}
		}
		// gates
		gates := make(map[string]api.Gate, len(step.Gates))
		for name, gate := range step.Gates {
			gateConfig := make(api.GateConfig, len(gate.Config))
			for k, v := range gate.Config {
				val, err := json.Marshal(v)
				if err == nil {
					gateConfig[k] = val
				}
			}
			gates[name] = api.Gate{
				Kind:     api.GateKind(gate.Kind.String()),
				Provider: gate.Provider,
				Config: api.OptGateConfig{
					Value: gateConfig,
					Set:   true,
				},
			}
		}
		// sso providers
		ssoProviders := make([]api.SSOProvider, 0, len(step.SSOProviders))
		for _, ssoProvider := range step.SSOProviders {
			ssoProviders = append(ssoProviders, api.SSOProvider{
				ID:       ssoProvider.ID,
				Name:     ssoProvider.Name,
				Template: ssoProvider.Template,
			})
		}
		// transitions
		transitions := make(map[string]api.FlowDefinitionStepTransitionsItem, len(step.Transitions))
		for n, transition := range step.Transitions {
			var action string
			if transition.Action != nil {
				action = transition.Action.String()
			}
			transitions[n] = api.FlowDefinitionStepTransitionsItem{
				Target: transition.Target,
				Action: api.OptNilFlowDefinitionStepTransitionsItemAction{
					Value: api.FlowDefinitionStepTransitionsItemAction(action),
					Set:   transition.Action != nil, // todo: review
					Null:  transition.Action == nil,
				},
			}
		}

		var complete string
		if step.Complete != nil {
			complete = step.Complete.String()
		}
		apiStep := api.FlowDefinitionStep{
			Name:   step.Name,
			Fields: step.Fields,
			Actions: api.OptFlowDefinitionStepActions{
				Value: actions,
				Set:   true,
			},
			Gates: api.OptFlowDefinitionStepGates{
				Value: gates,
				Set:   true,
			},
			SSOProviders: ssoProviders,
			Transitions: api.OptFlowDefinitionStepTransitions{
				Value: transitions,
				Set:   true,
			},
			Complete: api.OptFlowDefinitionStepComplete{
				Value: api.FlowDefinitionStepComplete(complete),
				Set:   step.Complete != nil,
			},
		}
		if step.OnSuccess != nil {
			apiStep.OnSuccess = api.OptFlowDefinitionStepOnSuccess{
				Value: api.FlowDefinitionStepOnSuccess(step.OnSuccess.String()),
				Set:   true,
			}
		}
		steps = append(steps, apiStep)
	}
	return steps
}
