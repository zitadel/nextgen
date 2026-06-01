package api

import (
	"context"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/service"
)

type Handler struct {
	// UnimplementedHandler is embedded to provide default "not implemented"
	// responses for all endpoints, so only implemented methods need to be defined.
	api.UnimplementedHandler

	crypter               crypto.Crypter
	flowService           service.FlowService
	authAttemptService    service.AuthAttemptService
	sessionService        service.SessionService
	projectService        service.ProjectService
	schemaService         *service.SchemaService
	flowDefinitionService service.FlowDefinitionService
	teamService           *service.TeamService
	userService           *service.UserService
}

func NewHandler(
	crypto crypto.Crypter,
	flowService service.FlowService,
	authAttemptService service.AuthAttemptService,
	sessionService service.SessionService,
	projectService service.ProjectService,
	schemaService *service.SchemaService,
	flowDefinitionService service.FlowDefinitionService,
	teamService *service.TeamService,
	userService *service.UserService,
) *Handler {
	return &Handler{
		crypter:               crypto,
		flowService:           flowService,
		authAttemptService:    authAttemptService,
		sessionService:        sessionService,
		projectService:        projectService,
		schemaService:         schemaService,
		flowDefinitionService: flowDefinitionService,
		teamService:           teamService,
		userService:           userService,
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
