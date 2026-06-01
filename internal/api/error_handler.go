package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-faster/errors"
	"github.com/go-faster/jx"
	"github.com/ogen-go/ogen/ogenerrors"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// domainErrorDetails extracts a domain.Error from err and returns it as an
// api.ErrorDetails. If err is not a domain.Error, ErrInternal is used as
// the fallback so the response is always well-formed.
func domainErrorDetails(err error) api.ErrorDetails {
	var domErr domain.Error
	if !errors.As(err, &domErr) {
		domErr = domain.ErrInternal(err)
	}
	apiErrDetails := api.ErrorDetails{
		Code:    api.ErrorCode(domErr.Code),
		Message: domErr.Message,
	}
	if domErr.Details != nil {
		details := make(map[string]jx.Raw)
		b, err := json.Marshal(domErr.Details)
		if err == nil {
			details["details"] = b // todo (grvijayan): temp
			apiErrDetails.Details = api.OptErrorDetailsDetails{
				Value: details,
				Set:   true,
			}
		}
	}
	return apiErrDetails
}

func errorResponse(err error) *api.ErrorDetailsStatusCode {
	var e domain.Error
	if !errors.As(err, &e) {
		return internalErrorResponse(err)
	}
	switch {
	case strings.HasPrefix(e.Code, domain.PrefixAuthAttempt.ErrorCodePrefix("")):
		return authAttemptErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixFlowDefinition.ErrorCodePrefix("")):
		return flowDefinitionErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixSession.ErrorCodePrefix("")):
		return sessionErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixJSONSchema.ErrorCodePrefix("")):
		return schemaErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixProject.ErrorCodePrefix("")):
		return projectErrorResponse(e)
	case e.Code == domain.ErrAuthUnauthorized(nil).Code:
		return errorResponseWithStatusCode(http.StatusUnauthorized, e)
	case e.Code == domain.ErrNotImplemented().Code:
		return errorResponseWithStatusCode(http.StatusNotImplemented, e)
	case strings.HasPrefix(e.Code, domain.PrefixTeam.ErrorCodePrefix("")):
		return teamErrorResponse(e)
	default:
		return internalErrorResponse(err)
	}
}

// errorResponse is a convenience helper for the common case where the caller
// knows exactly which HTTP status to use for this operation.
func errorResponseWithStatusCode(status int, err error) *api.ErrorDetailsStatusCode {
	return &api.ErrorDetailsStatusCode{
		StatusCode: status,
		Response:   domainErrorDetails(err),
	}
}

// internalErrorResponse returns a 500 for unexpected errors.
func internalErrorResponse(err error) *api.ErrorDetailsStatusCode {
	return errorResponseWithStatusCode(http.StatusInternalServerError, err)
}

func projectErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrProjectNotFound().Code,
		domain.ErrProjectClaimNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrProjectClaimRequired().Code,
		domain.ErrProjectAlreadyClaimed().Code,
		domain.ErrProjectIdempotencyConflict().Code:
		return errorResponseWithStatusCode(http.StatusConflict, err)
	case domain.ErrProjectClaimExpired().Code,
		domain.ErrProjectSecretConsumed().Code:
		return errorResponseWithStatusCode(http.StatusGone, err)
	default:
		return internalErrorResponse(err)
	}
}

// OgenErrorHandler is a custom ogen ErrorHandler that maps ogen's structural
// errors (decode, validate, security) into the ErrorDetails wire format so all
// error responses are consistent regardless of where the error originates.
func OgenErrorHandler(_ context.Context, w http.ResponseWriter, _ *http.Request, err error) {
	var (
		status  int
		details api.ErrorDetails
	)

	switch {
	case isSecurityError(err):
		status = http.StatusUnauthorized
		d := domainErrorDetails(domain.ErrAuthUnauthorized(err))
		d.Message = err.Error()
		details = d

	case isDecodeError(err):
		status = http.StatusBadRequest
		d := domainErrorDetails(domain.ErrRequestInvalid())
		d.Message = err.Error()
		details = d

	default:
		resp := errorResponse(err)
		status = resp.StatusCode
		details = resp.Response
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	data, err := details.MarshalJSON()
	if err == nil {
		_, _ = w.Write(data)
	}
}

func isSecurityError(err error) bool {
	var target *ogenerrors.SecurityError
	return errors.As(err, &target)
}

func isDecodeError(err error) bool {
	var decodeParams *ogenerrors.DecodeParamsError
	var decodeRequest *ogenerrors.DecodeRequestError
	return errors.As(err, &decodeParams) || errors.As(err, &decodeRequest)
}
