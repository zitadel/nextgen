package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/ogen-go/ogen/ogenerrors"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/service"
)

type Handler struct {
	// UnimplementedHandler is embedded to provide default "not implemented"
	// responses for all endpoints, so only implemented methods need to be defined.
	api.UnimplementedHandler

	schemaService *service.SchemaService
	flowService   service.FlowService
}

func NewHandler(
	schemaService *service.SchemaService,
	flowService service.FlowService,
) *Handler {
	return &Handler{
		schemaService: schemaService,
		flowService:   flowService,
	}
}

func (h *Handler) NewError(ctx context.Context, err error) *api.ErrorDetailsStatusCode {
	if errors.Is(err, ogenerrors.ErrSecurityRequirementIsNotSatisfied) {
		return &api.ErrorDetailsStatusCode{
			StatusCode: http.StatusUnauthorized,
			Response: api.ErrorDetails{
				Code:    "auth_not_satisfied",
				Message: err.Error(),
			},
		}
	}
	return &api.ErrorDetailsStatusCode{
		StatusCode: http.StatusInternalServerError,
		Response: api.ErrorDetails{
			Code:    "unknown_error",
			Message: err.Error(),
		},
	}
}

var _ api.Handler = (*Handler)(nil)
