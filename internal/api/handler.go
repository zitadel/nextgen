package api

import (
	"context"

	api "github.com/zitadel/nextgen/api/generated"
)

type Handler struct {
}

func NewHandler() *Handler {
	return &Handler{}
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
