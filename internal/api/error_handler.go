package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync/atomic"

	"github.com/go-faster/errors"
	"github.com/go-faster/jx"
	"github.com/ogen-go/ogen/ogenerrors"
	"github.com/ogen-go/ogen/validate"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/errorpage"
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
	if domain.IsServerFault(err) {
		return serverFaultResponse(err)
	}
	var e domain.Error
	errors.As(err, &e)
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
	case strings.HasPrefix(e.Code, domain.PrefixPolicy.ErrorCodePrefix("")):
		return policyErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixEnvironment.ErrorCodePrefix("")):
		return environmentErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixRelease.ErrorCodePrefix("")):
		return releaseErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixIDPConnection.ErrorCodePrefix("")):
		return idpErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixDeployment.ErrorCodePrefix("")):
		return deploymentErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixOrigin.ErrorCodePrefix("")):
		return originErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixEvent.ErrorCodePrefix("")):
		return eventErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixVariable.ErrorCodePrefix("")):
		return variableErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixUser.ErrorCodePrefix("")):
		return userErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixTeam.ErrorCodePrefix("")):
		return teamErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixGrant.ErrorCodePrefix("")):
		return grantErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixProject.ErrorCodePrefix("")):
		return projectErrorResponse(e)
	case strings.HasPrefix(e.Code, domain.PrefixClaimChallenge.ErrorCodePrefix("")),
		strings.HasPrefix(e.Code, domain.PrefixClaim.ErrorCodePrefix("")):
		return claimErrorResponse(e)
	case e.Code == domain.ErrRequestInvalid().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, e)
	case e.Code == domain.ErrRequestNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, e)
	case e.Code == domain.ErrRequestMethodNotAllowed().Code:
		return errorResponseWithStatusCode(http.StatusMethodNotAllowed, e)
	default:
		return internalErrorResponse(err)
	}
}

// serverFaultResponse answers a [domain.IsServerFault] error: 501 for a
// feature that is not implemented, 503 for a transient failure worth retrying,
// and 500 for everything else. Only the outermost domain error counts, the
// one whose code the body carries: an internal error that wraps an
// unavailable one is a 500.
func serverFaultResponse(err error) *api.ErrorDetailsStatusCode {
	var e domain.Error
	errors.As(err, &e)
	switch e.Code {
	case domain.ErrNotImplemented().Code:
		return errorResponseWithStatusCode(http.StatusNotImplemented, err)
	case domain.ErrUnavailable().Code:
		return errorResponseWithStatusCode(http.StatusServiceUnavailable, err)
	default:
		return internalErrorResponse(err)
	}
}

// genericServerFault is the bare sentinel for the status serverFaultResponse
// gives fault, so the client learns that status without the message or parent
// the fault was raised with.
func genericServerFault(fault domain.Error) domain.Error {
	switch fault.Code {
	case domain.ErrNotImplemented().Code:
		return domain.ErrNotImplemented()
	case domain.ErrUnavailable().Code:
		return domain.ErrUnavailable()
	default:
		return domain.ErrInternal(nil)
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
func OgenErrorHandler(ctx context.Context, w http.ResponseWriter, _ *http.Request, err error) {
	var (
		status  int
		details api.ErrorDetails
	)

	switch {
	case isSecurityServerFault(err):
		// The security handler could not decide (CSRF request state missing, or
		// the token or key store failing while introspecting the credential): a
		// server fault, not a refused credential. The client gets the status
		// serverFaultResponse gives the fault (500, 501 or 503) with that
		// status's generic answer; the cause goes to the log, where a wiring
		// mistake that makes every cookie request fail has to be findable.
		// Logged as a domain.Error too, so its parent (the actual cause) is kept.
		var cause domain.Error
		_ = errors.As(err, &cause)
		slog.ErrorContext(ctx, "security handler could not reach a decision", "error", err, "cause", cause)
		resp := serverFaultResponse(genericServerFault(cause))
		status = resp.StatusCode
		details = resp.Response

	case isCSRFError(err):
		status = http.StatusForbidden
		details = domainErrorDetails(domain.ErrAuthCSRFInvalid())

	case isSecurityError(err):
		status = http.StatusUnauthorized
		details = securityErrorDetails(err)

	case isDecodeError(err):
		status = http.StatusBadRequest
		// Use the stable domain message — do not echo ogen/framework
		// decode text into the client envelope (ADR 030). The parameter or
		// the field paths ogen rejected do go into details.
		invalid := domain.ErrRequestInvalid()
		if fields := invalidRequestFields(err); len(fields) > 0 {
			invalid = invalid.WithDetails(domain.InvalidFieldPathsDetails{Fields: fields})
		}
		details = domainErrorDetails(invalid)

	default:
		resp := errorResponse(err)
		status = resp.StatusCode
		details = resp.Response
	}

	writeErrorResponse(w, &api.ErrorDetailsStatusCode{StatusCode: status, Response: details})
}

// OgenNotFound answers a path no API operation matches (ADR 076). A browser
// navigation gets the error page, with home as its way on; everything else
// gets the req.not_found envelope, so a client can tell a path this server
// lacks from one that is not a Zitadel API at all. The Accept header decides,
// and Vary says so to caches.
func OgenNotFound(home *errorpage.Link) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Vary", "Accept")
		if errorpage.Wants(r) {
			errorpage.Write(w, r, errorpage.NotFound(home))
			return
		}
		writeErrorResponse(w, errorResponse(domain.ErrRequestNotFound()))
	}
}

// OgenMethodNotAllowed answers a path whose operations do not take the
// request's method with the req.method_not_allowed envelope and the Allow
// header ogen would have set (ADR 076). A path the API defines answers the
// envelope even to a browser: it is an API URL. A CORS preflight keeps ogen's
// own answer, 204 with the Access-Control-Allow-* headers ogen has already
// set.
func OgenMethodNotAllowed(w http.ResponseWriter, r *http.Request, allowed string) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Allow", allowed)
	writeErrorResponse(w, errorResponse(domain.ErrRequestMethodNotAllowed()))
}

func writeErrorResponse(w http.ResponseWriter, resp *api.ErrorDetailsStatusCode) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	data, err := resp.Response.MarshalJSON()
	if err == nil {
		_, _ = w.Write(data)
	}
}

// csrfInvalidCode is compared on every error response, so it is read once:
// building a domain.Error captures its origin.
var csrfInvalidCode = domain.ErrAuthCSRFInvalid().Code

// isCSRFError reports a session-cookie request refused by the CSRF checks. It
// arrives wrapped in ogen's SecurityError, but it is a refusal of an
// authenticated caller, not a missing credential: 403, not 401.
func isCSRFError(err error) bool {
	var e domain.Error
	return errors.As(err, &e) && e.Code == csrfInvalidCode
}

// isSecurityServerFault reports a security handler that failed to reach a
// decision, as opposed to one that refused the credential: the error it
// returned carries a domain error whose code is a server fault. An error with
// no domain code, such as ogenerrors.ErrSecurityRequirementIsNotSatisfied, is
// a refusal.
func isSecurityServerFault(err error) bool {
	var e domain.Error
	return isSecurityError(err) && errors.As(err, &e) && domain.IsServerFault(e)
}

func isSecurityError(err error) bool {
	var target *ogenerrors.SecurityError
	return errors.As(err, &target)
}

// securityErrorDetails maps an ogen security failure to the auth.unauthorized
// wire contract. Session-only ops use sessionUnauthorizedMessage; dual-scheme
// ops stay on the default unauthorized message (ADR 030, Decision 4).
func securityErrorDetails(err error) api.ErrorDetails {
	unauthorized := domain.ErrAuthUnauthorized(err)
	if secErr := new(ogenerrors.SecurityError); errors.As(err, &secErr) && sessionCookieOperations[secErr.OperationContext.Name] {
		unauthorized = unauthorized.WithMessage(sessionUnauthorizedMessage)
	}
	return domainErrorDetails(unauthorized)
}

// invalidRequestFields names what a request that would not decode got wrong:
// the parameter (path, query, header or cookie) by its name in the spec, or
// the body's fields by validationFieldPaths. Without it the req.invalid
// message would point at details that are not there.
func invalidRequestFields(err error) []string {
	var param *ogenerrors.DecodeParamError
	if errors.As(err, &param) && param.Name != "" {
		return []string{param.Name}
	}
	return validationFieldPaths(err)
}

// validationFieldPaths returns the dotted paths of the fields ogen's request
// validation rejected, or nil when decoding failed for another reason, such as
// malformed JSON. Only the names are returned: a leaf error can quote the
// rejected value. For map-typed fields (for example claim_mapping,
// verified_claims, static_authorize_parameters) the generated validator names
// an entry by the client's own key, so a path like idp.claim_mapping.<key>
// echoes client input as a name, never a value or decoder text, which ADR 030
// allows.
func validationFieldPaths(err error) []string {
	var verr *validate.Error
	if !errors.As(err, &verr) {
		return nil
	}
	return appendFieldPaths(nil, "", verr)
}

func appendFieldPaths(paths []string, prefix string, verr *validate.Error) []string {
	for _, field := range verr.Fields {
		path := field.Name
		if prefix != "" {
			path = prefix + "." + field.Name
		}
		var nested *validate.Error
		if errors.As(field.Error, &nested) {
			paths = appendFieldPaths(paths, path, nested)
			continue
		}
		paths = append(paths, path)
	}
	return paths
}

func isDecodeError(err error) bool {
	var decodeParams *ogenerrors.DecodeParamsError
	var decodeRequest *ogenerrors.DecodeRequestError
	return errors.As(err, &decodeParams) || errors.As(err, &decodeRequest)
}
