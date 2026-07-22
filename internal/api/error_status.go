package api

import (
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// codeHTTPStatus is the explicit domain error code → HTTP status manifest for
// resource mappers in internal/api. Auth/opaque overrides (for example flow
// cookie failures → 401 while flow.not_found → 404) are encoded here, not
// inferred from suffixes (ADR 030).
var codeHTTPStatus = map[string]int{
	// User
	domain.ErrUserInvalid().Code:          http.StatusBadRequest,
	domain.ErrUserNotFound().Code:         http.StatusNotFound,
	domain.ErrUserAlreadyExists().Code:    http.StatusConflict,
	domain.ErrUserPermissionDenied().Code: http.StatusForbidden,

	// Project
	domain.ErrProjectNotFound().Code:         http.StatusNotFound,
	domain.ErrProjectPermissionDenied().Code: http.StatusForbidden,
	domain.ErrProjectNameInvalid().Code:      http.StatusBadRequest,

	// Team
	domain.ErrTeamNotFound().Code:         http.StatusNotFound,
	domain.ErrTeamProjectNotFound().Code:  http.StatusNotFound,
	domain.ErrTeamPermissionDenied().Code: http.StatusForbidden,

	// JSON Schema
	domain.ErrJSONSchemaNotFound().Code:         http.StatusNotFound,
	domain.ErrJSONSchemaAlreadyExists().Code:    http.StatusConflict,
	domain.ErrJSONSchemaInvalid().Code:          http.StatusBadRequest,
	domain.ErrJSONSchemaPermissionDenied().Code: http.StatusForbidden,

	// Session
	domain.ErrSessionNotFound().Code:            http.StatusNotFound,
	domain.ErrSessionTokenCreationFailed().Code: http.StatusInternalServerError,
	domain.ErrSessionExchangeConflict().Code:    http.StatusBadRequest,
	domain.ErrSessionInvalidHandoffToken().Code: http.StatusBadRequest,
	domain.ErrSessionTokenInvalid().Code:        http.StatusUnauthorized,
	domain.ErrNotImplemented().Code:             http.StatusNotImplemented,
	domain.ErrSessionInvalidTTL().Code:          http.StatusBadRequest,

	// Auth attempt
	domain.ErrAuthAttemptNotFound().Code:         http.StatusNotFound,
	domain.ErrAuthAttemptInvalidRequest().Code:   http.StatusBadRequest,
	domain.ErrAuthAttemptInvalidProof().Code:     http.StatusBadRequest,
	domain.ErrAuthAttemptInvalidState().Code:     http.StatusConflict,
	domain.ErrAuthAttemptAlreadyCompleted().Code: http.StatusConflict,
	domain.ErrAuthAttemptNotCompleted().Code:     http.StatusConflict,
	domain.ErrAuthAttemptStaleChallenge().Code:   http.StatusConflict,
	domain.ErrAuthAttemptProofRejected(nil).Code: http.StatusConflict,

	// Flow runtime
	domain.ErrFlowCookieInvalid().Code:   http.StatusUnauthorized,
	domain.ErrFlowCookieExpired().Code:   http.StatusUnauthorized,
	domain.ErrFlowNotFound().Code:        http.StatusNotFound,
	domain.ErrFlowCompleted().Code:       http.StatusGone,
	domain.ErrFlowSessionConflict().Code: http.StatusConflict,
	domain.ErrFlowInvalidAction().Code:   http.StatusBadRequest,
	domain.ErrFlowUnsupported().Code:     http.StatusBadRequest,
	domain.ErrFlowInvalidPurpose().Code:  http.StatusBadRequest,

	// Flow definition
	domain.ErrFlowDefinitionNotFound().Code:          http.StatusNotFound,
	domain.ErrFlowDefinitionPurposeMismatch().Code:   http.StatusBadRequest,
	domain.ErrMissingFlowDefinitionID().Code:         http.StatusBadRequest,
	domain.ErrMissingProjectID().Code:                http.StatusBadRequest,
	domain.ErrFlowDefinitionInvalid(nil, nil).Code:   http.StatusBadRequest,
	domain.ErrFlowDefinitionAlreadyExists().Code:     http.StatusConflict,
	domain.ErrFlowDefinitionUpdateConflict(nil).Code: http.StatusConflict,
	domain.ErrFlowDefinitionPermissionDenied().Code:  http.StatusForbidden,
}

func statusForDomainCode(code string) (int, bool) {
	status, ok := codeHTTPStatus[code]
	return status, ok
}

func domainErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	if status, ok := statusForDomainCode(err.Code); ok {
		return errorResponseWithStatusCode(status, err)
	}
	return internalErrorResponse(err)
}
