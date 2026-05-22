package api

import (
	"context"
	"encoding/json"
	"net/url"

	"github.com/muhlemmer/gu"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h Handler) CreateFlowDefinition(ctx context.Context, req *api.CreateFlowDefinitionRequest) (api.CreateFlowDefinitionRes, error) {
	definition := req.GetFlowDefinition()
	rawFlowDefinition, err := definition.MarshalJSON()
	if err != nil {
		return &api.CreateFlowDefinitionBadRequest{
			Code:    "invalid_flow_definition",
			Message: "invalid flow definition",
		}, nil
	}

	userSchemaURI := definition.GetUserSchema()
	svcReq := service.CreateFlowDefinitionRequest{
		ProjectID:         string(req.GetProjectID()),
		Name:              definition.GetName(),
		UserSchema:        userSchemaURI.String(),
		RawFlowDefinition: rawFlowDefinition,
	}
	purposes, err := mapPurposesToDomain(definition)
	if err != nil {
		return &api.CreateFlowDefinitionBadRequest{
			Code:    "invalid_purpose",
			Message: err.Error(),
		}, nil
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

	create, flowSchemaURI, err := h.flowDefinitionService.Create(ctx, svcReq)
	if err != nil {
		return errorResponse(err), nil // todo: review
	}

	return flowDefinitionSuccessResponse(create, flowSchemaURI), nil
}

func mapPurposesToDomain(definition api.FlowDefinition) (map[domain.FlowDefinitionPurpose]string, error) {
	if len(definition.GetPurposes()) == 0 {
		return nil, domain.ErrFlowDefinitionInvalid("no purposes defined", nil)
	}
	purposes := make(map[domain.FlowDefinitionPurpose]string, len(definition.GetPurposes()))
	for p, entryStep := range definition.GetPurposes() {
		purpose, err := domain.FlowDefinitionPurposeString(p)
		if err != nil {
			return nil, domain.ErrFlowDefinitionInvalid("invalid purpose", nil)
		}
		purposes[purpose] = entryStep
	}
	return purposes, nil
}

func flowDefinitionSuccessResponse(flowDefinition *domain.FlowDefinition, schemaURI string) api.CreateFlowDefinitionRes {
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
				val, err := json.Marshal(v) // todo: review
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
			//OnSuccess: // todo: review
		}
		steps = append(steps, apiStep)
	}
	return steps
}
