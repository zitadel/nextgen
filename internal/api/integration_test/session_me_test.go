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
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
)

// TestGetMySession_Identity drives the HTTP path a signed-in app takes after
// login: exchange a handoff token for the __nextgen_session cookie, then read
// GET /sessions/me and assert the session identity payload carries the user's
// name and email hydrated from the conventional user-schema attributes.
func TestGetMySession_Identity(t *testing.T) {
	t.Parallel()

	testServer := harness.EnsureTestServer(t)

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	tokenCrypter, err := harness.EnsureKeyService(t).GetProjectCrypter(t.Context(), project.ID, domain.EncryptionKeyPurposeToken)
	require.NoError(t, err)
	projectSecret, err := project.ProjectSecret(tokenCrypter)
	require.NoError(t, err)

	harness.CreateUserSchema(t, project, harness.EnsureTestData(t).Schemas.CreateSchemaRequestUserSchema)
	userSchemaURL := "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml"

	// The user-id schema (components/schemas/user-id.yaml) requires the
	// `user_` prefix; ogen response validation enforces it.
	const userID = "user_session-me-test"
	// camelCase name parts: the shape the shipped presets actually collect
	// (packages/config/defaults/*.json) — regression guard for the identity
	// resolution reading only snake_case.
	attrs := make(domain.CreateAttributes, 0, 3)
	for key, value := range map[domain.AttributeKey]any{
		"email":      "ada@example.com",
		"givenName":  "Ada",
		"familyName": "Lovelace",
	} {
		attr, err := domain.NewCreateAttribute(key, value, domain.AttributeUniquenessUnspecified)
		require.NoError(t, err)
		attrs = append(attrs, *attr)
	}
	require.NoError(t, harness.EnsureUserFixture(t).Create(t.Context(), &domain.CreateUser{
		ProjectID:  project.ID,
		SchemaURL:  userSchemaURL,
		ID:         userID,
		Attributes: attrs,
	}))

	// A completed attempt with a verified user factor, handed off — the state
	// the flow engine leaves behind when a login flow reaches its terminal step.
	attempt := &domain.AuthAttempt{
		ProjectID:      project.ID,
		RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypeUser},
		Checks:         []domain.AuthCheck{&domain.AuthFactorUser{UserID: userID}},
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
		Name   string `json:"name"`
		Email  string `json:"email"`
	}
	require.NoError(t, json.NewDecoder(meResp.Body).Decode(&got))
	require.Equal(t, userID, got.UserID)
	require.Equal(t, "Ada Lovelace", got.Name)
	require.Equal(t, "ada@example.com", got.Email)
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

	tokenCrypter, err := harness.EnsureKeyService(t).GetProjectCrypter(t.Context(), project.ID, domain.EncryptionKeyPurposeToken)
	require.NoError(t, err)
	projectSecret, err := project.ProjectSecret(tokenCrypter)
	require.NoError(t, err)

	attempt := &domain.AuthAttempt{ProjectID: project.ID}
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
