package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"

	"github.com/go-faster/errors"
	"github.com/go-faster/jx"
	"github.com/ogen-go/ogen/ogenerrors"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// FullErrorInResponse attaches the unwrapped cause of an error to the response
// body under `details.parent`. It is a **test-only** aid: it turns an opaque
// "an unexpected error occurred" into the chain that produced it, which is what
// makes a red integration run diagnosable. Never enable it on a served
// instance — the chain carries internals (SQL, validation paths, wrapped
// library errors) that the client has no business seeing.
var FullErrorInResponse = atomic.Bool{}

// domainErrorDetails extracts a domain.Error from err and returns it as an
// api.ErrorDetails. If err is not a domain.Error, ErrInternal is used as
// the fallback so the response is always well-formed.
//
// Only Code, Message, and explicitly attached Details cross the wire.
// Parent and Origin metadata are diagnostics for logs and must never be serialized
// into API responses (ADR 030).
func domainErrorDetails(err error) api.ErrorDetails {
	var domErr domain.Error
	if !errors.As(err, &domErr) {
		domErr = domain.ErrInternal(err)
	}

	errDetails := api.ErrorDetails{
		Code:    api.ErrorCode(domErr.Code),
		Message: domErr.Message,
	}

	raw, hasProducer := marshalErrorDetails(domErr.Details)
	includeParent := FullErrorInResponse.Load() && domErr.Parent != nil
	if !hasProducer && !includeParent {
		return errDetails
	}

	wire := api.ErrorDetailsDetails{}
	if hasProducer {
		wire["details"] = raw
	}
	if includeParent {
		if errmap := createFullErrDetailsDetailsMap(domErr.Parent); errmap != nil {
			if j, err := json.Marshal(errmap); err == nil {
				wire["parent"] = j
			}
		}
	}
	if len(wire) == 0 {
		return errDetails
	}

	errDetails.Details = api.NewOptErrorDetailsDetails(wire)
	return errDetails
}

// marshalErrorDetails encodes producer-attached Details for the wire envelope
// under the legacy details.details slot (ADR 030). Returns false when there is
// nothing to send or encoding fails.
func marshalErrorDetails(details any) (jx.Raw, bool) {
	if details == nil {
		return nil, false
	}
	b, err := json.Marshal(details)
	if err != nil {
		return nil, false
	}
	return b, true
}

func createFullErrDetailsDetailsMap(err error) any {
	if err == nil {
		return nil
	}

	errmap := make(map[string]any)
	errmap["message"] = err.Error()
	errmap["type"] = fmt.Sprintf("%T", err)

	var domerr domain.Error
	if errors.As(err, &domerr) && domerr.Parent != nil {
		errmap["parent"] = createFullErrDetailsDetailsMap(domerr.Parent)
	}

	return errmap
}

func errorResponse(err error) *api.ErrorDetailsStatusCode {
	var e domain.Error
	if !errors.As(err, &e) {
		return internalErrorResponse(err)
	}
	switch {
	case e.Code == domain.ErrAuthUnauthorized(nil).Code:
		return errorResponseWithStatusCode(http.StatusUnauthorized, e)
	case strings.HasPrefix(e.Code, domain.PrefixAuthAttempt.ErrorCodePrefix("")):
		return authAttemptErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixFlow.ErrorCodePrefix("")):
		return flowErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixFlowDefinition.ErrorCodePrefix("")):
		return flowDefinitionErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixSession.ErrorCodePrefix("")):
		return sessionErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixJSONSchema.ErrorCodePrefix("")):
		return schemaErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixBranding.ErrorCodePrefix("")):
		return brandingErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixEvent.ErrorCodePrefix("")):
		return eventErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixUser.ErrorCodePrefix("")):
		return userErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixTeam.ErrorCodePrefix("")):
		return teamErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixProject.ErrorCodePrefix("")):
		return projectErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixClaimChallenge.ErrorCodePrefix("")),
		strings.HasPrefix(e.Code, domain.PrefixClaim.ErrorCodePrefix("")):
		return claimErrorResponse(e)
	case e.Code == domain.ErrNotImplemented().Code:
		return errorResponseWithStatusCode(http.StatusNotImplemented, e)
	case e.Code == domain.ErrUnavailable().Code:
		return errorResponseWithStatusCode(http.StatusServiceUnavailable, e)
	case e.Code == domain.ErrRequestInvalid().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, e)
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
		details = securityErrorDetails(err)

	case isDecodeError(err):
		status = http.StatusBadRequest
		// Use the stable domain message — do not echo ogen/framework
		// decode text into the client envelope (ADR 030).
		details = domainErrorDetails(domain.ErrRequestInvalid())

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

// securityErrorDetails maps an ogen security failure to the auth.unauthorized
// wire contract. Operations secured by the session cookie use the normalized
// message from their OpenAPI 401 descriptions; ogen reports an absent
// credential without naming the scheme, so the operation decides (ADR 030,
// Decision 4).
func securityErrorDetails(err error) api.ErrorDetails {
	unauthorized := domain.ErrAuthUnauthorized(err)
	if secErr := new(ogenerrors.SecurityError); errors.As(err, &secErr) && sessionCookieOperations[secErr.OperationContext.Name] {
		unauthorized = unauthorized.WithMessage(sessionUnauthorizedMessage)
	}
	return domainErrorDetails(unauthorized)
}

func isDecodeError(err error) bool {
	var decodeParams *ogenerrors.DecodeParamsError
	var decodeRequest *ogenerrors.DecodeRequestError
	return errors.As(err, &decodeParams) || errors.As(err, &decodeRequest)
}
