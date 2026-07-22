package api

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestStatusForDomainCode_manifest(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		err        domain.Error
		wantStatus int
	}{
		// User
		{name: "user.invalid", err: domain.ErrUserInvalid(), wantStatus: http.StatusBadRequest},
		{name: "user.not_found", err: domain.ErrUserNotFound(), wantStatus: http.StatusNotFound},
		{name: "user.already_exists", err: domain.ErrUserAlreadyExists(), wantStatus: http.StatusConflict},
		{name: "user.permission_denied", err: domain.ErrUserPermissionDenied(), wantStatus: http.StatusForbidden},

		// Project
		{name: "project.not_found", err: domain.ErrProjectNotFound(), wantStatus: http.StatusNotFound},
		{name: "project.permission_denied", err: domain.ErrProjectPermissionDenied(), wantStatus: http.StatusForbidden},
		{name: "project.name_invalid", err: domain.ErrProjectNameInvalid(), wantStatus: http.StatusBadRequest},

		// Team
		{name: "team.team_not_found", err: domain.ErrTeamNotFound(), wantStatus: http.StatusNotFound},
		{name: "team.project_not_found", err: domain.ErrTeamProjectNotFound(), wantStatus: http.StatusNotFound},
		{name: "team.permission_denied", err: domain.ErrTeamPermissionDenied(), wantStatus: http.StatusForbidden},

		// Schema
		{name: "sch.not_found", err: domain.ErrJSONSchemaNotFound(), wantStatus: http.StatusNotFound},
		{name: "sch.already_exists", err: domain.ErrJSONSchemaAlreadyExists(), wantStatus: http.StatusConflict},
		{name: "sch.invalid_request", err: domain.ErrJSONSchemaInvalid(), wantStatus: http.StatusBadRequest},
		{name: "sch.permission_denied", err: domain.ErrJSONSchemaPermissionDenied(), wantStatus: http.StatusForbidden},

		// Session
		{name: "sess.not_found", err: domain.ErrSessionNotFound(), wantStatus: http.StatusNotFound},
		{name: "sess.token_creation_failed", err: domain.ErrSessionTokenCreationFailed(), wantStatus: http.StatusInternalServerError},
		{name: "sess.exchange_conflict", err: domain.ErrSessionExchangeConflict(), wantStatus: http.StatusBadRequest},
		{name: "sess.invalid_handoff_token", err: domain.ErrSessionInvalidHandoffToken(), wantStatus: http.StatusBadRequest},
		{name: "sess.token_invalid", err: domain.ErrSessionTokenInvalid(), wantStatus: http.StatusUnauthorized},
		{name: "not_implemented", err: domain.ErrNotImplemented(), wantStatus: http.StatusNotImplemented},
		{name: "sess.invalid_ttl", err: domain.ErrSessionInvalidTTL(), wantStatus: http.StatusBadRequest},

		// Auth attempt
		{name: "att.not_found", err: domain.ErrAuthAttemptNotFound(), wantStatus: http.StatusNotFound},
		{name: "att.invalid_request", err: domain.ErrAuthAttemptInvalidRequest(), wantStatus: http.StatusBadRequest},
		{name: "att.invalid_proof", err: domain.ErrAuthAttemptInvalidProof(), wantStatus: http.StatusBadRequest},
		{name: "att.invalid_state", err: domain.ErrAuthAttemptInvalidState(), wantStatus: http.StatusConflict},
		{name: "att.already_completed", err: domain.ErrAuthAttemptAlreadyCompleted(), wantStatus: http.StatusConflict},
		{name: "att.not_completed", err: domain.ErrAuthAttemptNotCompleted(), wantStatus: http.StatusConflict},
		{name: "att.stale_challenge", err: domain.ErrAuthAttemptStaleChallenge(), wantStatus: http.StatusConflict},
		{name: "att.proof_rejected", err: domain.ErrAuthAttemptProofRejected(nil), wantStatus: http.StatusConflict},

		// Flow runtime — auth/opaque overrides
		{name: "flow.cookie_invalid", err: domain.ErrFlowCookieInvalid(), wantStatus: http.StatusUnauthorized},
		{name: "flow.cookie_expired", err: domain.ErrFlowCookieExpired(), wantStatus: http.StatusUnauthorized},
		{name: "flow.not_found", err: domain.ErrFlowNotFound(), wantStatus: http.StatusNotFound},
		{name: "flow.completed", err: domain.ErrFlowCompleted(), wantStatus: http.StatusGone},
		{name: "flow.session_conflict", err: domain.ErrFlowSessionConflict(), wantStatus: http.StatusConflict},
		{name: "flow.invalid_action", err: domain.ErrFlowInvalidAction(), wantStatus: http.StatusBadRequest},
		{name: "flow.unsupported", err: domain.ErrFlowUnsupported(), wantStatus: http.StatusBadRequest},
		{name: "flow.invalid_purpose", err: domain.ErrFlowInvalidPurpose(), wantStatus: http.StatusBadRequest},

		// Flow definition
		{name: "flowdef.not_found", err: domain.ErrFlowDefinitionNotFound(), wantStatus: http.StatusNotFound},
		{name: "flowdef.purpose_mismatch", err: domain.ErrFlowDefinitionPurposeMismatch(), wantStatus: http.StatusBadRequest},
		{name: "flowdef.missing_id", err: domain.ErrMissingFlowDefinitionID(), wantStatus: http.StatusBadRequest},
		{name: "flowdef.missing_project_id", err: domain.ErrMissingProjectID(), wantStatus: http.StatusBadRequest},
		{name: "flowdef.invalid", err: domain.ErrFlowDefinitionInvalid(nil, nil), wantStatus: http.StatusBadRequest},
		{name: "flowdef.already_exists", err: domain.ErrFlowDefinitionAlreadyExists(), wantStatus: http.StatusConflict},
		{name: "flowdef.update_conflict", err: domain.ErrFlowDefinitionUpdateConflict(nil), wantStatus: http.StatusConflict},
		{name: "flowdef.permission_denied", err: domain.ErrFlowDefinitionPermissionDenied(), wantStatus: http.StatusForbidden},
	}

	require.Len(t, tests, len(codeHTTPStatus), "every manifest entry must have a test case")

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			gotStatus, ok := statusForDomainCode(tt.err.Code)
			require.True(t, ok)
			assert.Equal(t, tt.wantStatus, gotStatus)

			resp := domainErrorResponse(tt.err)
			require.NotNil(t, resp)
			assert.Equal(t, tt.wantStatus, resp.StatusCode)
		})
	}
}

func TestDomainErrorResponse_unknownCodeIsInternal(t *testing.T) {
	t.Parallel()

	resp := domainErrorResponse(domain.Error{Code: "unknown.test", Message: "test"})
	require.NotNil(t, resp)
	assert.Equal(t, http.StatusInternalServerError, resp.StatusCode)
	assert.Equal(t, "unknown.test", string(resp.Response.Code))
}
