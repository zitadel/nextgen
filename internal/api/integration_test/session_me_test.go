//go:build postgres_integration || spanner_integration

package integration_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	internalapi "github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
)

// TestGetMySession_Identity drives the HTTP path a signed-in app takes after
// login: exchange a handoff token for the __nextgen_session cookie, then read
// GET /sessions/me and assert the session identity payload carries the user's
// resolved reference, derived from the schema's x-identifier/x-display
// designations (ADR 058).
func TestGetMySession_Identity(t *testing.T) {
	t.Parallel()

	testServer := harness.EnsureTestServer(t)

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	projectSecret, err := harness.EnsureTokenService(t).GenerateJWE(t.Context(), project.Token())
	require.NoError(t, err)

	userSchemaURL := harness.CreateUserSchema(t, project, `{
		"title": "SessionMeIdentitySchema",
		"metaSchema": "https://test.example.schemas.com/schemas/user-schema.json",
		"$id": "https://session-me.example.com/schemas/human-user.json",
		"kind": "user-schema",
		"objectType": "session-me-user",
		"type": "object",
		"x-identifier": "email",
		"x-display": ["givenName", "familyName"],
		"x-auth-methods": {"password": {"enabled": true}},
		"properties": {
			"email": {"type": "string", "format": "email", "x-unique": "project"},
			"givenName": {"type": "string"},
			"familyName": {"type": "string"}
		}
	}`)

	// The user-id schema (components/schemas/user-id.yaml) requires the
	// `user_` prefix; ogen response validation enforces it.
	const userID = "user_session-me-test"
	attrs := make(domain.CreateAttributes, 0, 3)
	for key, value := range map[domain.AttributeKey]any{
		"givenName":  "Ada",
		"familyName": "Lovelace",
	} {
		attr, err := domain.NewCreateAttribute(key, value, domain.AttributeUniquenessUnspecified)
		require.NoError(t, err)
		attrs = append(attrs, *attr)
	}
	emailAttr, err := domain.NewCreateAttribute("email", "ada@example.com", domain.AttributeUniquenessProject)
	require.NoError(t, err)
	attrs = append(attrs, *emailAttr)
	require.NoError(t, harness.EnsureUserFixture(t).Create(t.Context(), &domain.CreateUser{
		ProjectID:  project.ID,
		SchemaURL:  userSchemaURL,
		ID:         userID,
		Attributes: attrs,
	}))

	// A completed attempt with verified user + password factors, handed off —
	// the state the flow engine leaves behind when a login flow reaches its
	// terminal step. A credential-class factor is required: the bare user
	// factor never completes an attempt (see domain.AuthAttempt.IsCompleted).
	attempt := &domain.AuthAttempt{
		ProjectID:      project.ID,
		RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypeUser, domain.AuthCheckTypePassword},
		Checks:         []domain.AuthCheck{&domain.AuthFactorUser{UserID: userID}, &domain.AuthFactorPassword{}},
	}
	stmts := harness.EnsureServiceDB(t)
	require.NoError(t, stmts.Statements().CreateAuthAttempt(t.Context(), attempt))
	const plainToken = "handoff_session_me_test"
	sum := sha256.Sum256([]byte(plainToken))
	attempt.HandoffToken = &domain.HandoffToken{TokenHash: sum[:]}
	require.NoError(t, stmts.Statements().HandoffAuthAttempt(t.Context(), attempt))

	exchangeBody, err := json.Marshal(map[string]string{"handoff_token": plainToken})
	require.NoError(t, err)
	exchangeReq, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
		testServer.URL+"/sessions/exchange?project_id="+project.ID, bytes.NewReader(exchangeBody))
	require.NoError(t, err)
	exchangeReq.Header.Set("Content-Type", "application/json")

	exchangeReq.Header.Set("Authorization", "Bearer "+projectSecret)

	exchangeResp, err := testServer.Client().Do(exchangeReq)
	require.NoError(t, err)
	defer func() { _ = exchangeResp.Body.Close() }()
	if exchangeResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(exchangeResp.Body)
		t.Fatalf("exchange returned %d: %s", exchangeResp.StatusCode, body)
	}

	var sessionCookie *http.Cookie
	for _, cookie := range exchangeResp.Cookies() {
		if cookie.Name == "__nextgen_session" {
			sessionCookie = cookie
		}
	}
	require.NotNil(t, sessionCookie, "exchange must set the __nextgen_session cookie")

	meReq, err := http.NewRequestWithContext(t.Context(), http.MethodGet, testServer.URL+"/sessions/me", nil)
	require.NoError(t, err)
	meReq.AddCookie(sessionCookie)

	meResp, err := testServer.Client().Do(meReq)
	require.NoError(t, err)
	defer func() { _ = meResp.Body.Close() }()
	require.Equal(t, http.StatusOK, meResp.StatusCode)
	require.Equal(t, "private, no-store", meResp.Header.Get("Cache-Control"))

	var got struct {
		UserID string `json:"user_id"`
		User   struct {
			UserID             string `json:"user_id"`
			Identifier         string `json:"identifier"`
			IdentifierProperty string `json:"identifier_property"`
			Display            string `json:"display"`
		} `json:"user"`
	}
	require.NoError(t, json.NewDecoder(meResp.Body).Decode(&got))
	require.Equal(t, userID, got.UserID)
	require.Equal(t, userID, got.User.UserID)
	require.Equal(t, "ada@example.com", got.User.Identifier)
	require.Equal(t, "email", got.User.IdentifierProperty)
	require.Equal(t, "Ada Lovelace", got.User.Display)
}

// TestGetMySession_ExpiredSessionIsSignedOut pins the cross-layer contract the
// browser helper relies on: a decryptable cookie whose stored session has
// expired is a canonical signed-out verdict, not the internal
// sess.token_invalid diagnostic. The no-store assertion also proves the outer
// middleware covers handler-level failures.
func TestGetMySession_ExpiredSessionIsSignedOut(t *testing.T) {
	t.Parallel()

	testServer := harness.EnsureTestServer(t)

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	projectSecret, err := harness.EnsureTokenService(t).GenerateJWE(t.Context(), project.Token())
	require.NoError(t, err)

	// Completed by a verified password; no user, so the session has none.
	attempt := &domain.AuthAttempt{ProjectID: project.ID, Checks: []domain.AuthCheck{&domain.AuthFactorPassword{}}}
	stmts := harness.EnsureServiceDB(t)
	require.NoError(t, stmts.Statements().CreateAuthAttempt(t.Context(), attempt))
	const plainToken = "handoff_expired_session_me_test"
	sum := sha256.Sum256([]byte(plainToken))
	attempt.HandoffToken = &domain.HandoffToken{TokenHash: sum[:]}
	require.NoError(t, stmts.Statements().HandoffAuthAttempt(t.Context(), attempt))

	// One nanosecond is valid but has elapsed before the follow-up HTTP request
	// on both PostgreSQL and Spanner. Sending the response cookie explicitly
	// reproduces a stale browser cookie without a timing sleep.
	exchangeBody, err := json.Marshal(map[string]string{
		"handoff_token": plainToken,
		"ttl":           "PT0.000000001S",
	})
	require.NoError(t, err)
	exchangeReq, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
		testServer.URL+"/sessions/exchange?project_id="+project.ID, bytes.NewReader(exchangeBody))
	require.NoError(t, err)
	exchangeReq.Header.Set("Content-Type", "application/json")
	exchangeReq.Header.Set("Authorization", "Bearer "+projectSecret)

	exchangeResp, err := testServer.Client().Do(exchangeReq)
	require.NoError(t, err)
	defer func() { _ = exchangeResp.Body.Close() }()
	if exchangeResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(exchangeResp.Body)
		t.Fatalf("exchange returned %d: %s", exchangeResp.StatusCode, body)
	}

	var sessionCookie *http.Cookie
	for _, cookie := range exchangeResp.Cookies() {
		if cookie.Name == "__nextgen_session" {
			sessionCookie = cookie
		}
	}
	require.NotNil(t, sessionCookie, "exchange must set the __nextgen_session cookie")

	meReq, err := http.NewRequestWithContext(t.Context(), http.MethodGet, testServer.URL+"/sessions/me", nil)
	require.NoError(t, err)
	meReq.AddCookie(sessionCookie)

	meResp, err := testServer.Client().Do(meReq)
	require.NoError(t, err)
	defer func() { _ = meResp.Body.Close() }()
	require.Equal(t, http.StatusUnauthorized, meResp.StatusCode)
	require.Equal(t, "private, no-store", meResp.Header.Get("Cache-Control"))

	var got struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	require.NoError(t, json.NewDecoder(meResp.Body).Decode(&got))
	require.Equal(t, "auth.unauthorized", got.Code)
	require.Equal(t, "Missing or invalid session token.", got.Message)
}

// TestMySession_HoldsTheSessionToTheNamedProject pins the server side of
// project-bound session calls: with project_id, a live session of another
// project on the same server is refused with 403 sess.project_mismatch by the
// read, the CSRF token read and sign-out alike, so an app never reads it as one
// of its users and never ends it. The refused sign-out clears no cookie and
// leaves the session live. Its own project reads it, gets its token and signs
// it out as before.
func TestMySession_HoldsTheSessionToTheNamedProject(t *testing.T) {
	t.Parallel()

	testServer := harness.EnsureTestServer(t)
	projects := harness.EnsureProjectService(t)

	project, err := projects.Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	otherProject, err := projects.Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	projectSecret, err := harness.EnsureTokenService(t).GenerateJWE(t.Context(), project.Token())
	require.NoError(t, err)

	// Completed by a verified password; no user, so the session has none.
	attempt := &domain.AuthAttempt{ProjectID: project.ID, Checks: []domain.AuthCheck{&domain.AuthFactorPassword{}}}
	stmts := harness.EnsureServiceDB(t)
	require.NoError(t, stmts.Statements().CreateAuthAttempt(t.Context(), attempt))
	const plainToken = "handoff_session_me_project_test"
	sum := sha256.Sum256([]byte(plainToken))
	attempt.HandoffToken = &domain.HandoffToken{TokenHash: sum[:]}
	require.NoError(t, stmts.Statements().HandoffAuthAttempt(t.Context(), attempt))

	exchangeBody, err := json.Marshal(map[string]string{"handoff_token": plainToken})
	require.NoError(t, err)
	exchangeReq, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
		testServer.URL+"/sessions/exchange?project_id="+project.ID, bytes.NewReader(exchangeBody))
	require.NoError(t, err)
	exchangeReq.Header.Set("Content-Type", "application/json")
	exchangeReq.Header.Set("Authorization", "Bearer "+projectSecret)

	exchangeResp, err := testServer.Client().Do(exchangeReq)
	require.NoError(t, err)
	defer func() { _ = exchangeResp.Body.Close() }()
	if exchangeResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(exchangeResp.Body)
		t.Fatalf("exchange returned %d: %s", exchangeResp.StatusCode, body)
	}

	var sessionCookie *http.Cookie
	for _, cookie := range exchangeResp.Cookies() {
		if cookie.Name == "__nextgen_session" {
			sessionCookie = cookie
		}
	}
	require.NotNil(t, sessionCookie, "exchange must set the __nextgen_session cookie")

	call := func(method, path, projectID string) *http.Response {
		t.Helper()
		target := testServer.URL + path
		if projectID != "" {
			target += "?project_id=" + projectID
		}
		req, err := http.NewRequestWithContext(t.Context(), method, target, nil)
		require.NoError(t, err)
		req.AddCookie(sessionCookie)
		if method == http.MethodDelete {
			// Sign-out is a write: the project hold is checked once the
			// session's CSRF token has passed (ADR 053 §5).
			req.Header.Set(internalapi.CSRFHeader, internalapi.CSRFToken(sessionCookie.Value))
		}
		resp, err := testServer.Client().Do(req)
		require.NoError(t, err)
		t.Cleanup(func() { _ = resp.Body.Close() })
		return resp
	}
	requireRefused := func(resp *http.Response) {
		t.Helper()
		require.Equal(t, http.StatusForbidden, resp.StatusCode)
		var refusal struct {
			Code string `json:"code"`
		}
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&refusal))
		require.Equal(t, "sess.project_mismatch", refusal.Code)
		require.Empty(t, resp.Header.Values("Set-Cookie"), "the session of another project keeps its cookie")
	}

	refused := call(http.MethodGet, "/sessions/me", otherProject.ID)
	require.Equal(t, "private, no-store", refused.Header.Get("Cache-Control"))
	requireRefused(refused)

	refusedToken := call(http.MethodGet, "/sessions/me/csrf", otherProject.ID)
	require.Equal(t, "private, no-store", refusedToken.Header.Get("Cache-Control"))
	requireRefused(refusedToken)

	requireRefused(call(http.MethodDelete, "/sessions/me", otherProject.ID))

	served := call(http.MethodGet, "/sessions/me", project.ID)
	require.Equal(t, http.StatusOK, served.StatusCode, "a refused sign-out leaves the session live")
	var session struct {
		ProjectID string `json:"project_id"`
	}
	require.NoError(t, json.NewDecoder(served.Body).Decode(&session))
	require.Equal(t, project.ID, session.ProjectID)

	servedToken := call(http.MethodGet, "/sessions/me/csrf", project.ID)
	require.Equal(t, http.StatusOK, servedToken.StatusCode)
	var token struct {
		CsrfToken string `json:"csrf_token"`
	}
	require.NoError(t, json.NewDecoder(servedToken.Body).Decode(&token))
	require.NotEmpty(t, token.CsrfToken)

	signedOut := call(http.MethodDelete, "/sessions/me", project.ID)
	require.Equal(t, http.StatusNoContent, signedOut.StatusCode)
	var cleared bool
	for _, cookie := range signedOut.Cookies() {
		if cookie.Name == "__nextgen_session" && cookie.MaxAge < 0 {
			cleared = true
		}
	}
	require.True(t, cleared, "signing out of its own project clears the cookie")

	require.Equal(t, http.StatusUnauthorized, call(http.MethodGet, "/sessions/me", "").StatusCode,
		"the session is gone once its own project signed it out")
}
