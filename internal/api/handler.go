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

	flowSelector serviceflow.Selector
}

func NewHandler(flowSelector serviceflow.Selector) *Handler {
	return &Handler{flowSelector: flowSelector}
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
