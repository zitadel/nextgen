package api

import (
	"net/http"

	"github.com/go-faster/errors"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// domainErrorDetails extracts a domain.Error from err and returns it as an
// api.ErrorDetails. If err is not a domain.Error, ErrInternal is used as
// the fallback so the response is always well-formed.
func domainErrorDetails(err error) api.ErrorDetails {
	var domErr domain.Error
	if !errors.As(err, &domErr) {
		domErr = domain.ErrInternal()
	}
	return api.ErrorDetails{
		Code:    api.ErrorCode(domErr.Code),
		Message: domErr.Message,
	}
}

// errorResponse is a convenience helper for the common case where the caller
// knows exactly which HTTP status to use for this operation.
func errorResponse(status int, err error) *api.ErrorDetailsStatusCode {
	return &api.ErrorDetailsStatusCode{
		StatusCode: status,
		Response:   domainErrorDetails(err),
	}
}

// internalErrorResponse returns a 500 for unexpected errors.
func internalErrorResponse(err error) *api.ErrorDetailsStatusCode {
	return errorResponse(http.StatusInternalServerError, err)
}
