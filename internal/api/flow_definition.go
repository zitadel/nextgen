package api

import (
	"context"
	"errors"
	"net/url"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

var (
	ErrMissingPurpose = errors.New("missing purpose")
	ErrInvalidPurpose = errors.New("invalid purpose")
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

	svcReq := service.CreateFlowDefinitionRequest{
		FlowDefinition: domain.FlowDefinition{
			ProjectID:  string(req.GetProjectID()),
			Name:       definition.GetName(),
			UserSchema: definition.GetUserSchema(),
		},
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

	flowSchemaURI, ok := req.GetSchemaURI().Get()
	if ok {
		svcReq.FlowSchemaURI = url.URL(flowSchemaURI)
	}

	if reqAudience, ok := definition.GetAudience().Get(); ok {
		svcReq.Audience = domain.FlowDefinitionAudience{
			AppIDs:  reqAudience.GetAppIds(),
			TeamIDs: reqAudience.GetTeamIds(),
		}
	}

	create, err := h.flowDefinitionService.Create(ctx, svcReq)
	if err != nil {
		return nil, err // todo: map service errors to API errors
	}

	return flowDefinitionSuccessResponse(create, url.URL(flowSchemaURI)), nil
}

func mapPurposesToDomain(definition api.FlowDefinition) (map[domain.FlowDefinitionPurpose]string, error) {
	if len(definition.GetPurposes()) == 0 {
		return nil, ErrMissingPurpose
	}
	var purposes map[domain.FlowDefinitionPurpose]string
	for p, v := range definition.GetPurposes() {
		purpose, err := domain.FlowDefinitionPurposeString(p)
		if err != nil {
			return nil, ErrInvalidPurpose
		}
		purposes[purpose] = v
	}
	return purposes, nil
}

func flowDefinitionSuccessResponse(flowDefinition *domain.FlowDefinition, schemaURI url.URL) api.CreateFlowDefinitionRes {
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
		Name:       flowDefinition.Name,
		UserSchema: flowDefinition.UserSchema,
		Purposes:   purposes,
		Audience:   audience,
		Steps:      steps,
		ID:         flowDefinition.ID,
		ProjectID:  flowDefinition.ProjectID,
		SchemaURI:  schemaURI, // todo: weird to set it from the request
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
	steps := make([]api.FlowDefinitionStep, len(domainSteps))
	for _, step := range domainSteps {
		ssoProviders := make([]api.SSOProvider, len(step.SSOProviders))
		gates := make(map[string]api.Gate, len(step.Gates))
		for name, gate := range step.Gates {
			gates[name] = api.Gate{
				Kind:     api.GateKind(gate.Kind.String()),
				Provider: gate.Provider,
			}
		}
		for i, ssoProvider := range step.SSOProviders {
			ssoProviders[i] = api.SSOProvider{
				ID:       ssoProvider.ID,
				Name:     ssoProvider.Name,
				Template: ssoProvider.Template,
			}
		}
		apiStep := api.FlowDefinitionStep{
			Name:   step.Name,
			Fields: step.Fields,
			Actions: api.OptFlowDefinitionStepActions{
				Value: api.FlowDefinitionStepActions{},
				Set:   true,
			},
			Gates: api.OptFlowDefinitionStepGates{
				Value: api.FlowDefinitionStepGates{},
				Set:   true,
			},
			SSOProviders: ssoProviders,
			OnSuccess:    api.OptFlowDefinitionStepOnSuccess{},
			Complete:     api.OptFlowDefinitionStepComplete{},
			Transitions:  api.OptFlowDefinitionStepTransitions{},
		}
		steps = append(steps, apiStep)
	}
	return steps
}
