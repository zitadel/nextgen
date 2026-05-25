package api

import (
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

func authAttemptErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrAuthAttemptNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrAuthAttemptInvalidRequest().Code,
		domain.ErrAuthAttemptInvalidProof().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrAuthAttemptInvalidState().Code,
		domain.ErrAuthAttemptAlreadyCompleted().Code,
		domain.ErrAuthAttemptNotCompleted().Code,
		domain.ErrAuthAttemptStaleChallenge().Code,
		domain.ErrAuthAttemptProofRejected(nil).Code:
		return errorResponseWithStatusCode(http.StatusConflict, err)
	default:
		return internalErrorResponse(err)
	}
}
