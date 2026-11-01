//go:build postgres_integration || spanner_integration

package integration_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
)

// A step-up sign-in runs against an existing session and inherits its verified
// factors, so both entry points that accept a session_id require that
// session's own token. A session id alone, or with another session's token, is
// refused before any attempt or flow is linked to the session.
func TestStepUpRequiresSessionProof(t *testing.T) {
	project, _ := attemptProject(t)
	client := attemptClient(t, project)
	own := newAnonymousSession(t, client, project)

	createAttempt := func(t *testing.T, sessionID api.SessionID, token *string) api.CreateAuthAttemptRes {
		t.Helper()
		req := &api.CreateAuthAttemptRequest{
			ProjectID: api.ProjectID(project.ID),
			SessionID: api.NewOptNilSessionID(sessionID),
		}
		if token != nil {
			req.SessionToken = api.NewOptSessionProofToken(api.SessionProofToken(*token))
		}
		resp, err := client.CreateAuthAttempt(t.Context(), req)
		require.NoError(t, err)
		return resp
	}

	t.Run("auth attempt: session id alone is refused", func(t *testing.T) {
		requireAttemptRefused(t, createAttempt(t, own.Session.SessionID, nil))
	})
	t.Run("auth attempt: the session's own token links the attempt", func(t *testing.T) {
		resp := createAttempt(t, own.Session.SessionID, &own.SessionToken)
		require.IsType(t, &api.AuthAttemptResponse{}, resp, helpers.MustMarshal(t, resp))
		linked, ok := resp.(*api.AuthAttemptResponse).SessionID.Get()
		require.True(t, ok, "attempt not linked to the session")
		assert.Equal(t, own.Session.SessionID, linked)
	})

	defResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID:      api.ProjectID(project.ID),
		FlowDefinition: combinedPasswordFlowDefinition(apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)),
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, defResp, helpers.MustMarshal(t, defResp))

	deployPrimary(t, project.ID)
	startFlow := func(t *testing.T, sessionID string, token *string) api.CreateFlowRes {
		t.Helper()
		req := &api.CreateFlowRequest{
			ProjectID: api.ProjectID(project.ID),
			Purpose:   api.CreateFlowRequestPurposeLogin,
			SessionID: api.NewOptString(sessionID),
		}
		if token != nil {
			req.SessionToken = api.NewOptSessionProofToken(api.SessionProofToken(*token))
		}
		resp, err := client.CreateFlow(t.Context(), req, api.CreateFlowParams{})
		require.NoError(t, err)
		return resp
	}

	t.Run("flow: session id alone is refused", func(t *testing.T) {
		// createFlow declares its 400 explicitly, so the refusal decodes as
		// CreateFlowBadRequest (ErrorDetails) rather than the default error union.
		resp := startFlow(t, string(own.Session.SessionID), nil)
		refused, ok := resp.(*api.CreateFlowBadRequest)
		require.True(t, ok, "expected a refusal, got %s", helpers.MustMarshal(t, resp))
		require.Equal(t, api.ErrorCode("req.invalid"), refused.Code, helpers.MustMarshal(t, refused))
	})
	t.Run("flow: the session's own token starts the flow", func(t *testing.T) {
		resp := startFlow(t, string(own.Session.SessionID), &own.SessionToken)
		require.IsType(t, &api.FlowResponseHeaders{}, resp, helpers.MustMarshal(t, resp))
	})
}

// newAnonymousSession creates a building session over HTTP, so its
// session_token has a stored token record and the proof runs introspection's
// full path, the revocation and expiry lookup included. A session seeded in
// storage has no record, and Harness.SessionToken would mint it a token that
// introspection accepts without that lookup.
func newAnonymousSession(t *testing.T, client *helpers.ApiClient, project *domain.Project) api.SessionWithTokenResponse {
	t.Helper()
	resp, err := client.CreateSession(t.Context(), &api.CreateSessionRequest{ProjectID: api.ProjectID(project.ID)})
	require.NoError(t, err)
	require.IsType(t, &api.SessionWithTokenResponseHeaders{}, resp, helpers.MustMarshal(t, resp))
	return resp.(*api.SessionWithTokenResponseHeaders).Response
}

// requireAttemptRefused asserts the proof refusal itself, so a broken endpoint
// or another validation error cannot pass for it.
func requireAttemptRefused(t *testing.T, resp api.CreateAuthAttemptRes) {
	t.Helper()
	refused, ok := resp.(*api.CreateAuthAttemptErrorResponseStatusCode)
	require.True(t, ok, "expected a refusal, got %s", helpers.MustMarshal(t, resp))
	require.Equal(t, http.StatusBadRequest, refused.StatusCode, helpers.MustMarshal(t, refused))
	require.Equal(t, api.AttInvalidRequestCreateAuthAttemptErrorResponse, refused.Response.Type, helpers.MustMarshal(t, refused))
}
