package api

import (
	"context"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/cookie"
	"github.com/zitadel/nextgen/internal/service"
)

type Handler struct {
	// UnimplementedHandler is embedded to provide default "not implemented"
	// responses for all endpoints, so only implemented methods need to be defined.
	api.UnimplementedHandler

	sealer             *cookie.Sealer
	flowService        service.FlowService
	authAttemptService service.AuthAttemptService
	sessionService     service.SessionService
	projectService     service.ProjectService
	userService        *service.UserService
	schemaService      *service.SchemaService
	flowDefinitionService service.FlowDefinitionService
}

func NewHandler(
	sealer *cookie.Sealer,
	flowService service.FlowService,
	authAttemptService service.AuthAttemptService,
	sessionService service.SessionService,
	projectService service.ProjectService,
	userService *service.UserService,
	schemaService *service.SchemaService,
	flowDefinitionService service.FlowDefinitionService,
) *Handler {
	return &Handler{
		sealer:             sealer,
		flowService:        flowService,
		authAttemptService: authAttemptService,
		sessionService:     sessionService,
		projectService:     projectService,
		userService:        userService,
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
