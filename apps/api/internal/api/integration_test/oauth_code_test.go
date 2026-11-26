//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"crypto/ed25519"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/oidc/v3/pkg/oidc"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/events"
)

// TestOAuthCodeRedemption issues and redeems authorization codes through the
// service on the database, with a deployed release, a stored user and an
// active session. No HTTP path issues a code yet.
func TestOAuthCodeRedemption(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), []domain.Origin{
		{Pattern: oauthAppOrigin, Kind: domain.OriginKindPrimary},
	}, true)
	require.NoError(t, err)
	deployment := deployBundle(t, project.ID, service.BuildReleaseInput{
		ProjectID: project.ID,
		OAuth:     &service.CreateOAuthSettingsInput{ProjectID: project.ID, Enabled: true},
	})
	stmts := harness.EnsureServiceDB(t).Statements()
	requests := service.NewAuthRequestService(harness.EnsureServiceDB(t), harness.EnsureKeyService(t))

	const (
		redirectURI = "https://web.example.com/callback"
		verifier    = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
	)
	issuer := oauthAppOrigin + "/oauth/" + project.ID

	// issue stores an authorization request for a new active session of
	// userID and gives it a code.
	issue := func(t *testing.T, userID string) (code string, request *domain.AuthRequest, session *domain.Session) {
		t.Helper()
		session = harness.CreateActiveSession(t, project.ID, userID)
		request = &domain.AuthRequest{
			ProjectID:     project.ID,
			ClientID:      "web",
			RedirectURI:   redirectURI,
			State:         "xyz",
			CodeChallenge: oidc.NewSHACodeChallenge(verifier),
			Issuer:        issuer,
			DeploymentID:  deployment.ID,
			ReleaseID:     deployment.ReleaseID,
		}
		_, err := requests.Create(t.Context(), request)
		require.NoError(t, err)
		code, err = requests.IssueCode(t.Context(), project.ID, request.ID, userID, session.ID)
		require.NoError(t, err)
		return code, request, session
	}
	// exchangeFailures are the auth.request.exchange.failed events of the
	// request with requestID.
	exchangeFailures := func(t *testing.T, requestID string) []*domain.Event {
		t.Helper()
		opts := events.ListOptions(project.ID, 100)
		opts.Filter = database.And(opts.Filter,
			database.Equal(database.Col(domain.EventFieldEntityType), "auth_request"),
			database.Equal(database.Col(domain.EventFieldEntityID), requestID),
			database.Equal(database.Col(domain.EventFieldEventType), string(domain.EventTypeAuthRequestExchangeFailed)),
		)
		page, err := stmts.ListEvents(t.Context(), opts)
		require.NoError(t, err)
		return page.Items
	}
	input := func(code string) service.RedeemCodeInput {
		return service.RedeemCodeInput{
			ProjectID:    project.ID,
			ClientID:     "web",
			Code:         code,
			RedirectURI:  redirectURI,
			CodeVerifier: verifier,
		}
	}

	t.Run("a code is redeemed once for a signed access token", func(t *testing.T) {
		userID := harness.CreateUserWithTeam(t, project.ID)
		code, request, _ := issue(t, userID)

		token, expiresIn, err := requests.RedeemCode(t.Context(), input(code))
		require.NoError(t, err)
		assert.Equal(t, domain.AccessTokenTTL, expiresIn, "the session outlives the token")

		key, err := harness.EnsureKeyService(t).GetProjectSigningKey(t.Context(), project.ID, domain.SigningKeyPurposeToken)
		require.NoError(t, err)
		parsed, err := jose.ParseSigned(token, []jose.SignatureAlgorithm{jose.EdDSA})
		require.NoError(t, err)
		require.Len(t, parsed.Signatures, 1)
		header := parsed.Signatures[0].Header
		assert.Equal(t, key.ID, header.KeyID)
		assert.Equal(t, "at+jwt", header.ExtraHeaders[jose.HeaderType])
		payload, err := parsed.Verify(signingPublicKey(t, key))
		require.NoError(t, err)

		var claims map[string]any
		require.NoError(t, json.Unmarshal(payload, &claims))
		now := float64(time.Now().Unix())
		assert.InDelta(t, now, claims["iat"], 30)
		assert.InDelta(t, now+domain.AccessTokenTTL.Seconds(), claims["exp"], 30)
		assert.True(t, domain.TokenPrefix.Matches(claims["jti"].(string)), "jti %v", claims["jti"])
		for _, name := range []string{"iat", "exp", "jti"} {
			delete(claims, name)
		}
		assert.Equal(t, map[string]any{
			"iss":       issuer,
			"sub":       userID,
			"aud":       []any{"web"},
			"client_id": "web",
		}, claims, "no scope, nbf or sid")

		_, _, err = requests.RedeemCode(t.Context(), input(code))
		assert.ErrorIs(t, err, domain.ErrAuthCodeInvalid(), "a replayed code is refused")
		assert.Empty(t, exchangeFailures(t, request.ID), "a replayed code consumes nothing")
	})

	// The hash covers the whole code, so the deployment it names cannot be
	// changed.
	t.Run("a code names its deployment and a changed prefix finds no code", func(t *testing.T) {
		userID := harness.CreateUserWithTeam(t, project.ID)
		code, request, _ := issue(t, userID)
		assert.Equal(t, deployment.ID, domain.AuthCodeDeploymentID(code))
		_, random, _ := strings.Cut(code, ".")

		for _, changed := range []string{"dep_other." + random, random} {
			_, _, err := requests.RedeemCode(t.Context(), input(changed))
			assert.ErrorIs(t, err, domain.ErrAuthCodeInvalid(), "code %q", changed)
		}
		assert.Empty(t, exchangeFailures(t, request.ID), "a changed code consumes nothing")

		_, _, err := requests.RedeemCode(t.Context(), input(code))
		require.NoError(t, err, "the code still redeems")
	})

	t.Run("a refused redemption consumes the code", func(t *testing.T) {
		userID := harness.CreateUserWithTeam(t, project.ID)
		code, request, session := issue(t, userID)

		wrong := input(code)
		wrong.RedirectURI += "/other"
		_, _, err := requests.RedeemCode(t.Context(), wrong)
		require.ErrorIs(t, err, domain.ErrAuthCodeRedirectURIMismatch())

		_, _, err = requests.RedeemCode(t.Context(), input(code))
		assert.ErrorIs(t, err, domain.ErrAuthCodeInvalid())

		failures := exchangeFailures(t, request.ID)
		require.Len(t, failures, 1, "the refusal wrote one event, the replay none")
		assert.Equal(t, new(userID), failures[0].UserID)
		assert.Equal(t, new(session.ID), failures[0].SessionID)
		assert.JSONEq(t, `{"client_id":"web","reason":"redirect_uri_mismatch"}`, string(failures[0].Payload))
	})

	t.Run("a deleted session is refused", func(t *testing.T) {
		code, request, session := issue(t, harness.CreateUserWithTeam(t, project.ID))
		require.NoError(t, stmts.DeleteSessionByID(t.Context(), project.ID, session.ID))

		_, _, err := requests.RedeemCode(t.Context(), input(code))
		assert.ErrorIs(t, err, domain.ErrAuthCodeInvalid())
		failures := exchangeFailures(t, request.ID)
		require.Len(t, failures, 1)
		assert.JSONEq(t, `{"client_id":"web","reason":"session_not_active"}`, string(failures[0].Payload))
	})

	t.Run("a deactivated user is refused", func(t *testing.T) {
		userID := harness.CreateUserWithTeam(t, project.ID)
		code, request, _ := issue(t, userID)
		require.NoError(t, stmts.DeactivateUser(t.Context(), project.ID, userID))

		_, _, err := requests.RedeemCode(t.Context(), input(code))
		assert.ErrorIs(t, err, domain.ErrAuthCodeInvalid())
		failures := exchangeFailures(t, request.ID)
		require.Len(t, failures, 1)
		assert.JSONEq(t, `{"client_id":"web","reason":"user_not_active"}`, string(failures[0].Payload))
	})
}

// signingPublicKey is the public half of the project's signing key, decrypted
// through the key service as its signer is.
func signingPublicKey(t *testing.T, key *domain.SigningKey) ed25519.PublicKey {
	t.Helper()
	header, err := domain.DecodeJWEHeader(key.Key)
	require.NoError(t, err)
	kek, err := harness.EnsureKeyService(t).GetCrypter(t.Context(), header.KeyID, header.EncryptionAlgorithm)
	require.NoError(t, err)
	seed, err := kek.Decrypt(key.Key)
	require.NoError(t, err)
	return ed25519.NewKeyFromSeed([]byte(seed)).Public().(ed25519.PublicKey)
}
