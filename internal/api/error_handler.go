package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/ogen-go/ogen/ogenerrors"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

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
