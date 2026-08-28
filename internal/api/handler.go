package api

import (
	"context"
	"encoding/json"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/service"
)

type Handler struct {
	// UnimplementedHandler is embedded to provide default "not implemented"
	// responses for all endpoints, so only implemented methods need to be defined.
	api.UnimplementedHandler

	flowService           service.FlowService
	authAttemptService    service.AuthAttemptService
	sessionService        service.SessionService
	projectService        service.ProjectService
	userService           service.UserService
	schemaService         *service.SchemaService
	flowDefinitionService service.FlowDefinitionService
	teamService           *service.TeamService
	brandingService       *service.BrandingService
	eventService          *service.EventService
	tokenService          service.TokenService
	keyService            service.KeyService
	claimService          service.ClaimService
	grantService          *service.GrantService
	pool                  *service.DB

	// platformProjectID is the configured platform.project_id pin (ADR 046 §2).
	// Empty means the platform project is unresolved, so claim/complete rejects
	// every session.
	platformProjectID string
}

func NewHandler(
	flowService service.FlowService,
	authAttemptService service.AuthAttemptService,
	sessionService service.SessionService,
	projectService service.ProjectService,
	userService service.UserService,
	schemaService *service.SchemaService,
	flowDefinitionService service.FlowDefinitionService,
	teamService *service.TeamService,
	brandingService *service.BrandingService,
	eventService *service.EventService,
	tokenService service.TokenService,
	keyService service.KeyService,
	claimService service.ClaimService,
	grantService *service.GrantService,
	pool *service.DB,
	platformProjectID string,
) *Handler {
	return &Handler{
		flowService:           flowService,
		authAttemptService:    authAttemptService,
		sessionService:        sessionService,
		projectService:        projectService,
		userService:           userService,
		schemaService:         schemaService,
		flowDefinitionService: flowDefinitionService,
		teamService:           teamService,
		brandingService:       brandingService,
		eventService:          eventService,
		tokenService:          tokenService,
		keyService:            keyService,
		claimService:          claimService,
		grantService:          grantService,
		pool:                  pool,
		platformProjectID:     platformProjectID,
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
