package api

import (
	"context"
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
)

func NewNotFoundError() *api.ErrorDetailsStatusCode {
	return &api.ErrorDetailsStatusCode{
		StatusCode: http.StatusNotFound,
		Response: api.ErrorDetails{
			Code:    "auth error",
			Message: err.Error(),
		},
	}
}
