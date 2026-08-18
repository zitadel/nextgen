package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h Handler) CreateFlowDefinition(ctx context.Context, req *api.CreateFlowDefinitionRequest) (api.CreateFlowDefinitionRes, error) {
	if err := h.requireProjectAccess(ctx, string(req.GetProjectID()), flowDefinitionAccess, opWrite); err != nil {
		return nil, err
	}
	svcReq, err := mapCreateRequestToService(req)
	if err != nil {
		return nil, err
	}

	flowDefinition, err := h.flowDefinitionService.Create(ctx, svcReq)
	if err != nil {
		return nil, err
	}

	return flowDefinitionDetailResponse(flowDefinition), nil
}

func (h Handler) GetFlowDefinition(ctx context.Context, params api.GetFlowDefinitionParams) (api.GetFlowDefinitionRes, error) {
	projectID, err := h.requireResourceAccess(ctx, params.ID, flowDefinitionAccess, opRead)
	if err != nil {
		return nil, err
	}
	definition, err := h.flowDefinitionService.Get(ctx, projectID, params.ID)
	if err != nil {
		return nil, err
	}
	return flowDefinitionDetailResponse(definition), nil
}

func (h Handler) ListFlowDefinitions(ctx context.Context, params api.ListFlowDefinitionsParams) (api.ListFlowDefinitionsRes, error) {
	proceed, err := h.requireProjectListAccess(ctx, string(params.ProjectID), flowDefinitionAccess)
	if err != nil || !proceed {
		return nil, err
	}
	ctx, err = h.withAuthzListFilter(ctx, string(params.ProjectID), domain.ResourceKindFlowDefinition, opRead)
	if err != nil {
		return nil, err
	}
	svcReq := mapListRequestToService(params)

	listed, err := h.flowDefinitionService.List(ctx, svcReq)
	if err != nil {
		return nil, err
	}
	respDefinitions := make([]api.FlowDefinitionResponse, 0, len(listed.Items))
	for _, def := range listed.Items {
		respDefinitions = append(respDefinitions, flowDefinitionResponse(def))
	}
	resp := &api.FlowDefinitionListResponse{FlowDefinitions: respDefinitions}
	if listed.NextPageToken != "" {
		resp.NextPageToken = api.NewOptNilPageToken(api.PageToken(listed.NextPageToken))
	}
	return resp, nil
}

func (h Handler) UpdateFlowDefinition(ctx context.Context, req *api.FlowDefinitionUpdateRequest, params api.UpdateFlowDefinitionParams) (api.UpdateFlowDefinitionRes, error) {
	projectID, err := h.requireResourceAccess(ctx, params.ID, flowDefinitionAccess, opWrite)
	if err != nil {
		return nil, err
	}
	svcReq, err := mapUpdateRequestToService(projectID, params, req)
	if err != nil {
		return nil, err
	}

	flowDefinition, err := h.flowDefinitionService.Update(ctx, svcReq)
	if err != nil {
		return nil, err
	}

	resp := flowDefinitionDetailResponse(flowDefinition)
	return resp, nil
}

func (h Handler) DeleteFlowDefinition(ctx context.Context, params api.DeleteFlowDefinitionParams) (api.DeleteFlowDefinitionRes, error) {
	projectID, err := h.requireResourceAccess(ctx, params.ID, flowDefinitionAccess, opDelete)
	if err != nil {
		if errors.Is(err, errResourceGone) {
			return &api.DeleteFlowDefinitionNoContent{}, nil
		}
		return nil, err
	}
	err = h.flowDefinitionService.Delete(ctx, projectID, params.ID)
	if err != nil {
		return nil, err
	}
	return &api.DeleteFlowDefinitionNoContent{}, nil
}

/* ---------------- CONVERTERS ---------------- */

/* API request to service/domain converters */
func mapCreateRequestToService(req *api.CreateFlowDefinitionRequest) (service.FlowDefinitionRequest, error) {
	definition := req.GetFlowDefinition()
	return mapFlowDefinitionRequestToService(string(req.GetProjectID()), req.GetSchemaURI(), req.GetFlowDefinition(), strings.ToLower(string(definition.GetStatus())))
}

func mapUpdateRequestToService(projectID string, params api.UpdateFlowDefinitionParams, req *api.FlowDefinitionUpdateRequest) (service.FlowDefinitionRequest, error) {
	definition := req.GetFlowDefinition()
	svcReq, err := mapFlowDefinitionRequestToService(projectID, req.GetSchemaURI(), definition, strings.ToLower(string(definition.GetStatus())))
	if err != nil {
		return svcReq, err
	}
	svcReq.FlowDefinitionID = params.ID
	return svcReq, nil
}

func mapFlowDefinitionRequestToService(projectID string, schemaURI api.OptSchemaURI, definition api.FlowDefinition, status string) (service.FlowDefinitionRequest, error) {
	svcReq := service.FlowDefinitionRequest{
		ProjectID:     projectID,
		Name:          definition.GetName(),
		UserSchema:    definition.GetUserSchema(),
		Status:        status,
		SchemaVersion: "1.0.0", // todo (grvijayan): find a way to set this based on the schema URI or the request (currently not set in the request)
	}

	purposes := make(map[string]string, len(definition.GetPurposes()))
	for purpose, entryStep := range definition.GetPurposes() {
		purposes[purpose] = entryStep
	}
	svcReq.Purposes = purposes

	reqFlowSchemaURI, ok := schemaURI.Get()
	if ok {
		u := (url.URL)(reqFlowSchemaURI)
		svcReq.FlowSchemaURI = u.String()
	}

	if definition.GetAudience().IsSet() {
		svcReq.Audience = domain.FlowDefinitionAudience{
			AppIDs:  definition.Audience.Value.AppIds,
			TeamIDs: definition.Audience.Value.TeamIds,
		}
	}

	// map steps to domain
	steps := make([]domain.FlowDefinitionStep, 0, len(definition.GetSteps()))
	for _, step := range definition.GetSteps() {
		s := domain.FlowDefinitionStep{
			Name:   step.GetName(),
			Fields: domain.FieldsFromStrings(step.GetFields()),
		}
		// actions — preserve the nil-vs-empty distinction so an explicit `[]`
		// (deliberately no actions, e.g. terminal-step shape) survives the
		// round-trip distinct from an omitted field (engine-default behavior).
		if apiActions := step.GetActions(); apiActions != nil {
			actions := make([]domain.FlowStepAction, 0, len(apiActions))
			for _, apiAction := range apiActions {
				kind, err := domain.FlowActionKindString(string(apiAction.GetKind()))
				if err != nil {
					return svcReq, fmt.Errorf("step %q: action %q has invalid kind %q: %w", step.GetName(), apiAction.GetName(), apiAction.GetKind(), err)
				}
				actions = append(actions, domain.FlowStepAction{
					Name:    apiAction.GetName(),
					Kind:    kind,
					Primary: apiAction.GetPrimary().Value,
					TextKey: apiAction.GetTextKey().Value,
				})
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
				// Get() is false for both absent and explicit-null values;
				// IsSet() alone would map an explicit `null` to the zero
				// enum. Non-null strings are enum-validated by the
				// generated request decoder.
				var transitionAction *domain.FlowDefinitionTransitionAction
				if value, ok := apiTransition.Action.Get(); ok {
					a, _ := domain.FlowDefinitionTransitionActionString(string(value))
					transitionAction = &a
				}
				var transitionPurpose *domain.FlowDefinitionPurpose
				if value, ok := apiTransition.Purpose.Get(); ok {
					p, _ := domain.FlowDefinitionPurposeString(string(value))
					transitionPurpose = &p
				}

				t := domain.FlowStepTransition{
					Action:  transitionAction,
					Purpose: transitionPurpose,
					Target:  apiTransition.GetTarget(),
				}
				transitions[name] = t
			}
			s.Transitions = transitions
		}

		// complete
		if step.GetComplete().IsSet() {
			complete, err := domain.FlowStepCompleteString(string(step.GetComplete().Value))
			if err != nil {
				return svcReq, fmt.Errorf("step %q: invalid complete %q: %w", step.GetName(), step.GetComplete().Value, err)
			}
			s.Complete = &complete
		}

		// on_success
		if step.GetOnSuccess().IsSet() {
			onSuccess, err := domain.FlowOnSuccessString(string(step.GetOnSuccess().Value))
			if err != nil {
				return svcReq, fmt.Errorf("step %q: invalid on_success %q: %w", step.GetName(), step.GetOnSuccess().Value, err)
			}
			s.OnSuccess = &onSuccess
		}
		steps = append(steps, s)
	}
	svcReq.Steps = steps
	return svcReq, nil
}

func mapListRequestToService(params api.ListFlowDefinitionsParams) service.ListFlowDefinitionsRequest {
	req := service.ListFlowDefinitionsRequest{
		ProjectID: string(params.ProjectID),
	}
	purpose, ok := params.Purpose.Get()
	if ok {
		req.Purpose = string(purpose)
	}
	limit, ok := params.Limit.Get()
	if ok {
		req.Limit = int(limit)
	}
	pageToken, ok := params.PageToken.Get()
	if ok {
		req.PageToken = string(pageToken)
	}
	return req
}

/* domain to API response converters */

func flowDefinitionResponse(flowDefinition *domain.FlowDefinition) api.FlowDefinitionResponse {
	return api.FlowDefinitionResponse{
		ID:        flowDefinition.ID,
		Name:      flowDefinition.Name,
		ProjectID: flowDefinition.ProjectID,
		CreatedAt: flowDefinition.CreatedAt,
		UpdatedAt: flowDefinition.UpdatedAt,
		Status:    api.FlowDefinitionStatus(flowDefinition.Status.String()),
	}
}

func flowDefinitionDetailResponse(flowDefinition *domain.FlowDefinition) *api.FlowDefinitionDetailResponse {
	purposes := mapDomainPurposesToAPI(flowDefinition.Purposes)
	audience := api.OptFlowAudience{
		Value: api.FlowAudience{
			TeamIds: flowDefinition.Audience.TeamIDs,
			AppIds:  flowDefinition.Audience.AppIDs,
		},
		Set: true,
	}
	steps := mapDomainStepsToAPI(flowDefinition.Steps)

	return &api.FlowDefinitionDetailResponse{
		ID:        flowDefinition.ID,
		ProjectID: flowDefinition.ProjectID,
		FlowDefinition: api.FlowDefinition{
			Name:       flowDefinition.Name,
			Status:     api.FlowDefinitionStatus(flowDefinition.Status.String()),
			Steps:      steps,
			Purposes:   purposes,
			Audience:   audience,
			UserSchema: flowDefinition.UserSchema,
		},
		CreatedAt: flowDefinition.CreatedAt,
		UpdatedAt: flowDefinition.UpdatedAt,
	}
}

func mapDomainPurposesToAPI(domainPurposes map[domain.FlowDefinitionPurpose]string) api.FlowDefinitionPurposes {
	purposes := make(api.FlowDefinitionPurposes, len(domainPurposes))
	for purpose, entry := range domainPurposes {
		purposes[purpose.String()] = entry
	}
	return purposes
}

func mapDomainStepsToAPI(domainSteps []domain.FlowDefinitionStep) []api.FlowDefinitionStep {
	steps := make([]api.FlowDefinitionStep, 0, len(domainSteps))
	for _, step := range domainSteps {
		// actions
		actions := mapActionsToAPI(step.Actions)
		// gates
		gates := mapGatesToAPI(step.Gates)
		// sso providers
		ssoProviders := mapSSOProvidersToAPI(step.SSOProviders)
		// transitions
		transitions := mapTransitionsToAPI(step.Transitions)

		var complete string
		if step.Complete != nil {
			complete = step.Complete.String()
		}
		apiStep := api.FlowDefinitionStep{
			Name:    step.Name,
			Fields:  domain.FieldsToStrings(step.Fields),
			Actions: actions,
			Gates: api.OptFlowDefinitionStepGates{
				Value: gates,
				Set:   gates != nil,
			},
			SSOProviders: ssoProviders,
			Transitions: api.OptFlowDefinitionStepTransitions{
				Value: transitions,
				Set:   transitions != nil,
			},
			Complete: api.OptFlowDefinitionStepComplete{
				Value: api.FlowDefinitionStepComplete(complete),
				Set:   step.Complete != nil,
			},
			OnSuccess: api.OptFlowDefinitionStepOnSuccess{
				Value: api.FlowDefinitionStepOnSuccess(onSuccessString(step.OnSuccess)),
				Set:   step.OnSuccess != nil,
			},
		}
		steps = append(steps, apiStep)
	}
	return steps
}

// mapActionsToAPI preserves the nil-vs-empty distinction so a stored flow
// definition's explicit `[]` round-trips back to the client as `[]` (not
// omitted), keeping sync/diff tooling honest.
func mapActionsToAPI(domainActions []domain.FlowStepAction) []api.StepAction {
	if domainActions == nil {
		return nil
	}
	actions := make([]api.StepAction, 0, len(domainActions))
	for _, action := range domainActions {
		actions = append(actions, api.StepAction{
			Name: action.Name,
			Kind: api.StepActionKind(action.Kind.String()),
			Primary: api.OptBool{
				Value: action.Primary,
				Set:   action.Primary,
			},
			TextKey: api.OptString{
				Value: action.TextKey,
				Set:   action.TextKey != "",
			},
		})
	}
	return actions
}

func mapTransitionsToAPI(domainTransitions map[string]domain.FlowStepTransition) map[string]api.FlowDefinitionStepTransitionsItem {
	if len(domainTransitions) == 0 {
		return nil
	}
	transitions := make(map[string]api.FlowDefinitionStepTransitionsItem, len(domainTransitions))
	for n, transition := range domainTransitions {
		var action string
		if transition.Action != nil {
			action = transition.Action.String()
		}
		var purpose string
		if transition.Purpose != nil {
			purpose = transition.Purpose.String()
		}
		transitions[n] = api.FlowDefinitionStepTransitionsItem{
			Target: transition.Target,
			Action: api.OptNilFlowDefinitionStepTransitionsItemAction{
				Value: api.FlowDefinitionStepTransitionsItemAction(action),
				Set:   transition.Action != nil,
				Null:  transition.Action == nil,
			},
			Purpose: api.OptNilFlowDefinitionStepTransitionsItemPurpose{
				Value: api.FlowDefinitionStepTransitionsItemPurpose(purpose),
				Set:   transition.Purpose != nil,
				Null:  transition.Purpose == nil,
			},
		}
	}
	return transitions
}

func mapSSOProvidersToAPI(domainSSOProviders []domain.FlowSSOProvider) []api.SSOProvider {
	if len(domainSSOProviders) == 0 {
		return nil
	}
	ssoProviders := make([]api.SSOProvider, 0, len(domainSSOProviders))
	for _, ssoProvider := range domainSSOProviders {
		ssoProviders = append(ssoProviders, api.SSOProvider{
			ID:       ssoProvider.ID,
			Name:     ssoProvider.Name,
			Template: ssoProvider.Template,
		})
	}
	return ssoProviders
}

func mapGatesToAPI(domainGates map[string]domain.FlowStepGate) map[string]api.Gate {
	if len(domainGates) == 0 {
		return nil
	}
	gates := make(map[string]api.Gate, len(domainGates))
	for name, gate := range domainGates {
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
	return gates
}

func onSuccessString(o *domain.FlowOnSuccess) string {
	if o == nil {
		return ""
	}
	return o.String()
}
