// Package flow_definitions embeds the default flow definitions for use by the
// internal packages, and maps wire flow definitions to the domain.
package flow_definitions

import (
	"fmt"
	"net/url"
	"strings"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	configdefaults "github.com/zitadel/nextgen/packages/config/defaults"
)

func DefaultLoginFlowDefinitions(serverURL string, projectID string) ([]*domain.FlowDefinition, error) {
	definition, err := fromDocument(configdefaults.DefaultLoginFlowDefinition(), serverURL, projectID)
	if err != nil {
		return nil, err
	}
	return []*domain.FlowDefinition{definition}, nil
}

// fromDocument decodes a flow definition file as a create request, then maps
// it to the domain as the API handler does.
func fromDocument(document []byte, serverURL string, projectID string) (*domain.FlowDefinition, error) {
	content := strings.ReplaceAll(string(document), "${SERVER_URL}", serverURL)
	content = fmt.Sprintf(
		`{"project_id":%q,"schema_uri":%q,"flow_definition":%s}`,
		projectID,
		configdefaults.DefaultFlowSchemaURI,
		content,
	)

	req := &api.CreateFlowDefinitionRequest{}
	if err := req.UnmarshalJSON([]byte(content)); err != nil {
		return nil, err
	}
	if err := req.Validate(); err != nil {
		return nil, err
	}

	purposes, err := domain.FlowDefinitionPurposesFromStrings(req.FlowDefinition.GetPurposes())
	if err != nil {
		return nil, err
	}
	steps, err := StepsFromAPI(req.FlowDefinition.GetSteps())
	if err != nil {
		return nil, err
	}
	return domain.NewFlowDefinition(
		"",
		projectID,
		req.FlowDefinition.GetName(),
		new(url.URL(req.GetSchemaURI().Value)).String(),
		req.FlowDefinition.GetUserSchema(),
		purposes,
		AudienceFromAPI(req.FlowDefinition.GetAudience()),
		steps,
	)
}
