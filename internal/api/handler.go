package api

import (
	"context"
	"encoding/json"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/service"
)

type Handler struct {
	// UnimplementedHandler is embedded to provide default "not implemented"
	// responses for all endpoints, so only implemented methods need to be defined.
	api.UnimplementedHandler

	crypter                    crypto.Crypter
	flowService                service.FlowService
	authAttemptService         service.AuthAttemptService
	sessionService             service.SessionService
	projectService             service.ProjectService
	userService                *service.UserService
	schemaService              *service.SchemaService
	flowDefinitionService      service.FlowDefinitionService
	teamService                *service.TeamService
	passkeyRegistrationService *service.PasskeyRegistrationService
}

func NewHandler(
	crypto crypto.Crypter,
	flowService service.FlowService,
	authAttemptService service.AuthAttemptService,
	sessionService service.SessionService,
	projectService service.ProjectService,
	userService *service.UserService,
	schemaService *service.SchemaService,
	flowDefinitionService service.FlowDefinitionService,
	teamService *service.TeamService,
	passkeyRegistrationService *service.PasskeyRegistrationService,
) *Handler {
	return &Handler{
		crypter:                    crypto,
		flowService:                flowService,
		authAttemptService:         authAttemptService,
		sessionService:             sessionService,
		projectService:             projectService,
		userService:                userService,
		schemaService:              schemaService,
		flowDefinitionService:      flowDefinitionService,
		teamService:                teamService,
		passkeyRegistrationService: passkeyRegistrationService,
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

// ---- Converters -------------------------------------------------------------

func convertUsingJson[T any](source any) (*T, error) {
	// unmarshalling and unmarshalling is not performant, but I don't want to write a custom converter using reflection.
	// as long https://github.com/ogen-go/ogen/issues/1313 is open, I don't see another way.
	bs, err := json.Marshal(source)
	if err != nil {
		return nil, err
	}
	target := new(T)
	err = json.Unmarshal(bs, target)
	return target, err
}
