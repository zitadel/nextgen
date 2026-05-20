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

	flowSchemaURI, ok := req.GetSchemaURI().Get()
	if !ok {
		// todo: use the latest schema version from the built-in schemas
	}

	svcReq := service.CreateFlowDefinitionRequest{
		FlowDefinition: domain.FlowDefinition{
			ProjectID:  string(req.GetProjectID()),
			Name:       definition.GetName(),
			UserSchema: definition.GetUserSchema(),
		},
		FlowSchemaURI:     url.URL(flowSchemaURI),
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

	if reqAudience, ok := definition.GetAudience().Get(); ok {
		svcReq.Audience = domain.FlowDefinitionAudience{
			AppIDs:  reqAudience.GetAppIds(),
			TeamIDs: reqAudience.GetTeamIds(),
		}
	}

	return nil, nil

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
