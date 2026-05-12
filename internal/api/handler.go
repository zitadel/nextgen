package api

import (
	"context"

	api "github.com/zitadel/nextgen/api/generated"
	serviceflow "github.com/zitadel/nextgen/internal/service/flow"
)

type Handler struct {
	// UnimplementedHandler is embedded to provide default "not implemented"
	// responses for all endpoints, so only implemented methods need to be defined.
	api.UnimplementedHandler

	flowService serviceflow.Service
}

func NewHandler(flowService serviceflow.Service) *Handler {
	return &Handler{flowService: flowService}
}

func (h Handler) NewError(ctx context.Context, err error) *api.ErrorDetailsStatusCode {
	return &api.ErrorDetailsStatusCode{
		StatusCode: 401,
		Response: api.ErrorDetails{
			Code:    "auth error",
			Message: err.Error(),
		},
	}
}

var _ api.Handler = (*Handler)(nil)
