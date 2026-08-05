//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// getMyUserStatus sends GET /users/me with the session cookie set by hand. The
// generated client cannot express "credential present but rejected": a security
// failure is answered before the operation, so the typed response never arrives.
func getMyUserStatus(t *testing.T, sessionToken string) (int, string) {
	t.Helper()

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet,
		harness.EnsureTestServer(t).URL+"/users/me", nil)
	require.NoError(t, err)
	req.AddCookie(&http.Cookie{Name: "__nextgen_session", Value: sessionToken})

	resp, err := harness.EnsureHttpClient(t).Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	if resp.StatusCode == http.StatusOK {
		return resp.StatusCode, ""
	}
	var answer struct {
		Code string `json:"code"`
	}
	require.NoError(t, json.Unmarshal(body, &answer), string(body))
	return resp.StatusCode, answer.Code
}

// signedInSession creates a user with a password, signs them in, and returns
// the session plus the encrypted session token a client would carry.
func signedInSession(t *testing.T, project *domain.Project, email string) (*domain.Session, string) {
	t.Helper()

	userService := harness.EnsureUserService(t)
	user, err := userService.CreateUser(t.Context(), service.CreateUserInput{
		ProjectID: project.ID,
		User:      harness.EnsureTestData(t).Generator.GenerateUser(t, email),
	})
	require.NoError(t, err)

	const password = "fake-password"
	require.NoError(t, userService.SetPassword(t.Context(), service.SetPasswordInput{
		ProjectID: project.ID,
		UserID:    user["id"].(string),
		Password:  password,
	}))

	session, err := helpers.CreateSessionUsingPassword(t,
		harness.EnsureAuthAttemptService(t),
		harness.EnsureSessionService(t),
		project.ID,
		user["email"].(string),
		password,
	)
	require.NoError(t, err)

	tokenCrypter, err := harness.EnsureKeyService(t).GetProjectCrypter(t.Context(), project.ID, domain.EncryptionKeyPurposeToken)
	require.NoError(t, err)
	sessionToken, err := session.Token(tokenCrypter)
	require.NoError(t, err)

	return session, sessionToken
}

// TestRevokedSessionTokenIsRejected is the acceptance test for token
// revocation: a token that still decrypts must stop being accepted once its
// record is revoked, which deletes it.
//
// Decryption alone proves only that this deployment minted the token. Before
// the verifier consulted the record, a revoked session's cookie kept working
// until its own `exp` passed, because `GET /users/me` reads the user named in
// the token and never checks that the session still exists.
func TestRevokedSessionTokenIsRejected(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	t.Run("revoking the record rejects the token", func(t *testing.T) {
		t.Parallel()

		session, sessionToken := signedInSession(t, project, "revoke.record@example.com")

		// The credential works while the record is active.
		status, _ := getMyUserStatus(t, sessionToken)
		require.Equal(t, http.StatusOK, status)

		require.NoError(t, harness.EnsureTokenService(t).RevokeToken(t.Context(), project.ID, session.TokenID))

		// Same token, same decryption — the record is what changed.
		status, code := getMyUserStatus(t, sessionToken)
		assert.Equal(t, http.StatusUnauthorized, status)
		assert.Equal(t, "auth.unauthorized", code)
	})

	t.Run("deleting the session rejects its token", func(t *testing.T) {
		t.Parallel()

		session, sessionToken := signedInSession(t, project, "revoke.session@example.com")

		status, _ := getMyUserStatus(t, sessionToken)
		require.Equal(t, http.StatusOK, status)

		require.NoError(t, harness.EnsureSessionService(t).Delete(t.Context(), service.DeleteSessionInput{
			ProjectID: project.ID,
			SessionID: session.ID,
		}))

		status, code := getMyUserStatus(t, sessionToken)
		assert.Equal(t, http.StatusUnauthorized, status,
			"a deleted session must not leave a token that still verifies")
		assert.Equal(t, "auth.unauthorized", code)
	})

	t.Run("an unrevoked session token keeps working", func(t *testing.T) {
		t.Parallel()

		// Guards the enforcement against being a blanket rejection: revoking
		// one session must not disturb another.
		_, sessionToken := signedInSession(t, project, "revoke.untouched@example.com")
		other, _ := signedInSession(t, project, "revoke.other@example.com")

		require.NoError(t, harness.EnsureTokenService(t).RevokeToken(t.Context(), project.ID, other.TokenID))

		status, _ := getMyUserStatus(t, sessionToken)
		assert.Equal(t, http.StatusOK, status)
	})
}

// TestProjectSecretIsRevocable pins the other half of the change: the project
// credential is now issued with a stored `jti`, so a leaked secret can be
// retired without waiting for an expiry it does not have.
func TestProjectSecretIsRevocable(t *testing.T) {
	t.Parallel()

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)

	created, err := client.CreateProject(t.Context(), &api.CreateProjectRequest{
		Name: helpers.ProjectName(),
	})
	require.NoError(t, err)
	require.IsType(t, &api.CreateProjectResponse{}, created, helpers.MustMarshal(t, created))
	project := created.(*api.CreateProjectResponse)

	// The issued secret authenticates the operator plane.
	operator, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	operator.SetToken(project.ProjectSecret)

	resp, err := operator.GetProject(t.Context(), api.GetProjectParams{ProjectID: api.ProjectID(project.ID)})
	require.NoError(t, err)
	require.IsType(t, &api.ProjectResponse{}, resp, helpers.MustMarshal(t, resp))

	// The secret carries the id of its record, which is what makes it revocable.
	parsed, err := harness.EnsureTokenService(t).IntrospectToken(t.Context(), project.ProjectSecret)
	require.NoError(t, err)
	require.NotEmpty(t, parsed.TokenID, "an issued project secret carries the jti of its stored record")
	assert.Equal(t, domain.TokenTypeProjectToken, parsed.Type)

	require.NoError(t, harness.EnsureTokenService(t).RevokeToken(t.Context(), project.ID, parsed.TokenID))

	_, err = harness.EnsureTokenService(t).IntrospectToken(t.Context(), project.ProjectSecret)
	assert.Error(t, err, "a revoked project secret no longer verifies")
}
