//go:build integration

package integration_test

import (
	"crypto/sha256"
	"encoding/json"
	"net/url"
	"testing"
	"time"

	"github.com/descope/virtualwebauthn"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// TestBeginPasskeyRegistrationRejectsUnauthorizedOrigin verifies that
// BeginPasskeyRegistration returns an error when the Origin is not in the
// project's PreviewOrigins allowlist. Origin is validated before the session
// is resolved, so no valid session is needed.
func TestBeginPasskeyRegistrationRejectsUnauthorizedOrigin(t *testing.T) {
	// Create a project locked to a specific origin.
	project, err := harness.EnsureProjectService(t).Create(t.Context(), []string{"https://allowed.example.com"})
	require.NoError(t, err)

	client := harness.EnsureAPIClient(t, project.ID)
	resp, err := client.BeginPasskeyRegistration(t.Context(), &api.BeginPasskeyRegistrationRequest{
		ProjectID: project.ID,
		SessionID: "dummy-session-id", // never reached; origin check fires first
	}, api.BeginPasskeyRegistrationParams{
		Origin: "https://evil.example.com",
	})
	require.NoError(t, err, "ogen client should not error; the server returns an error response")
	_, ok := resp.(*api.BeginPasskeyRegistrationResponse)
	require.False(t, ok, "expected error response for unauthorized origin, got success: %+v", resp)
}

// TestStandalonePasskeyRegistration exercises the standalone passkey enrollment
// API (POST /passkeys → POST /passkeys/{id}/finish) using a session-authenticated
// user. It does not go through the flow engine.
func TestStandalonePasskeyRegistration(t *testing.T) {
	testServer := harness.EnsureTestServer(t)

	// --- Project + user setup ---
	project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
	require.NoError(t, err)

	harness.CreateUserSchema(t, project.ID, harness.Schemas.CreateSchemaRequestUserSchema)

	userSchemaURL, err := url.Parse(
		"https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml",
	)
	require.NoError(t, err)

	team, err := harness.EnsureTeamService(t).CreateTeam(t.Context(), service.CreateTeamInput{
		ProjectID: project.ID,
	})
	require.NoError(t, err)

	db := harness.EnsureDBPool(t)

	const userID = "standalone-pkreg-user"

	emailAttr, err := domain.NewCreateAttribute("email", "standalone-pkreg@example.com", domain.AttributeUniquenessUnspecified)
	require.NoError(t, err)

	userRepo := harness.EnsureUserRepo(t)
	require.NoError(t, userRepo.Create(t.Context(), db, &domain.CreateUser{
		ProjectID:  project.ID,
		SchemaURL:  userSchemaURL.String(),
		ID:         userID,
		TeamID:     &team.ID,
		Attributes: []*domain.CreateAttribute{emailAttr},
	}))

	// --- Create an authenticated session for the user via auth attempt exchange ---
	// There is no passkey to use for auth yet, so we seed a user factor directly.
	authAttemptRepo := harness.EnsureAuthAttemptRepo(t)
	attempt := &domain.AuthAttempt{
		ProjectID:      project.ID,
		RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypeUser},
		Checks: []domain.AuthCheck{
			&domain.AuthFactorUser{UserID: userID},
		},
	}
	require.NoError(t, authAttemptRepo.Create(t.Context(), db, attempt))

	plainToken := "standalone-pkreg-handoff-" + time.Now().Format("150405.000000")
	sum := sha256.Sum256([]byte(plainToken))
	attempt.HandoffToken = &domain.HandoffToken{TokenHash: sum[:]}
	require.NoError(t, authAttemptRepo.Handoff(t.Context(), db, attempt))

	sessionRepo := harness.EnsureSessionRepo(t)
	session, err := sessionRepo.Exchange(t.Context(), db, project.ID, plainToken, nil, time.Hour)
	require.NoError(t, err)
	require.NotNil(t, session.UserID, "session must carry a user ID after exchange")
	require.Equal(t, userID, *session.UserID)

	// --- Virtual authenticator (new credential, no prior enrollment) ---
	rpOriginStr := testServer.URL
	rpOriginURL, err := url.Parse(rpOriginStr)
	require.NoError(t, err)
	rpIDStr := rpOriginURL.Hostname()

	rp := virtualwebauthn.RelyingParty{ID: rpIDStr, Name: rpIDStr, Origin: rpOriginStr}
	auth := virtualwebauthn.NewAuthenticatorWithOptions(virtualwebauthn.AuthenticatorOptions{
		UserHandle: []byte(userID),
	})
	cred := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)

	// --- POST /passkeys (begin) ---
	client := harness.EnsureAPIClient(t, project.ID)
	beginResp, err := client.BeginPasskeyRegistration(t.Context(), &api.BeginPasskeyRegistrationRequest{
		ProjectID: project.ID,
		SessionID: session.ID,
	}, api.BeginPasskeyRegistrationParams{
		Origin: rpOriginStr,
	})
	require.NoError(t, err)
	beginOK, ok := beginResp.(*api.BeginPasskeyRegistrationResponse)
	require.True(t, ok, "expected BeginPasskeyRegistrationResponse, got %T: %+v", beginResp, beginResp)
	require.NotEmpty(t, beginOK.RegistrationID)

	// --- Generate fake attestation from creation options ---
	creationOptionsJSON, err := json.Marshal(beginOK.Options)
	require.NoError(t, err)
	attestOpts, err := virtualwebauthn.ParseAttestationOptions(string(creationOptionsJSON))
	require.NoError(t, err)
	attestationJSON := virtualwebauthn.CreateAttestationResponse(rp, auth, cred, *attestOpts)

	var attestation api.FinishPasskeyRegistrationRequestAttestation
	require.NoError(t, json.Unmarshal([]byte(attestationJSON), &attestation))

	// --- POST /passkeys/{registration_id}/finish ---
	finishResp, err := client.FinishPasskeyRegistration(t.Context(), &api.FinishPasskeyRegistrationRequest{
		ProjectID:   project.ID,
		Attestation: attestation,
	}, api.FinishPasskeyRegistrationParams{
		RegistrationID: beginOK.RegistrationID,
	})
	require.NoError(t, err)
	finishOK, ok := finishResp.(*api.FinishPasskeyRegistrationResponse)
	require.True(t, ok, "expected FinishPasskeyRegistrationResponse, got %T: %+v", finishResp, finishResp)
	require.Equal(t, beginOK.RegistrationID, finishOK.PasskeyID)
	require.False(t, finishOK.CreatedAt.IsZero())

	// --- Assert the credential was persisted ---
	passkeyRepo := harness.EnsureUserPasskeyRepo(t)
	pks, err := passkeyRepo.List(t.Context(), db,
		database.WithCondition(passkeyRepo.ProjectIDCondition(project.ID)),
		database.WithCondition(passkeyRepo.UserIDCondition(userID)),
	)
	require.NoError(t, err)
	require.Len(t, pks, 1, "expected exactly one passkey after standalone registration")
}
