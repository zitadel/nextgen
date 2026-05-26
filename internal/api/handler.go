package api

import (
	"context"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/service"
)

type Handler struct {
	// UnimplementedHandler is embedded to provide default "not implemented"
	// responses for all endpoints, so only implemented methods need to be defined.
	api.UnimplementedHandler

	flowService        service.FlowService
	authAttemptService service.AuthAttemptService
	projectService     service.ProjectService
	schemaService      *service.SchemaService
	flowDefinitionService service.FlowDefinitionService
}

func NewHandler(
	flowService service.FlowService,
	authAttemptService service.AuthAttemptService,
	projectService service.ProjectService,
	schemaService *service.SchemaService,
	flowDefinitionService service.FlowDefinitionService,
) *Handler {
	return &Handler{
		flowService:        flowService,
		authAttemptService: authAttemptService,
		projectService:     projectService,
		schemaService:      schemaService,
		flowDefinitionService: flowDefinitionService,
	}
}

// NewError implements the api.Handler interface and is used by ogen to convert any error
// returned by an endpoint handler into a well-formed error response.
// By centralizing this logic here, we can ensure that all errors are handled
// consistently regardless of where they originate.
func (h *Handler) NewError(ctx context.Context, err error) *api.ErrorDetailsStatusCode {
	return errorResponse(err)
}

var _ api.Handler = (*Handler)(nil)
