package service_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/oidc/v3/pkg/oidc"
	"go.uber.org/mock/gomock"

	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
)

// ssoConnectionDocument is a static-endpoint connection, so building the
// client makes no discovery call.
func ssoConnectionDocument(pkce bool) []byte {
	doc := `{
		"slug": "google",
		"protocol": "oidc",
		"display_name": "Google",
		"oidc": {
			"issuer": "https://accounts.example.test",
			"client_id": "client-1",
			"client_secret": "${{ GOOGLE_SECRET }}",
			"scopes": ["openid", "email"],
			"pkce_enabled": ` + map[bool]string{true: "true", false: "false"}[pkce] + `,
			"authorization_endpoint": "https://accounts.example.test/authorize",
			"token_endpoint": "https://accounts.example.test/token",
			"userinfo_endpoint": "https://accounts.example.test/userinfo",
			"jwks_uri": "https://accounts.example.test/keys"
		}
	}`
	return []byte(doc)
}

var ssoIssueInput = domain.FlowIssueSSORedirectInput{
	ProjectID:    "proj-1",
	AttemptID:    "attempt-1",
	ProviderSlug: "google",
	RedirectURI:  "https://auth.example.com/__nextgen/idp/callback",
	ReturnTarget: "https://auth.example.com/login?flow=flow-1",
}

// failingTransport stands in for an unreachable provider.
type failingTransport struct{}

func (failingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("dial tcp: connection refused")
}

func TestFlowSSORedirectIssuer_Issue(t *testing.T) {
	t.Parallel()

	t.Run("builds the authorize url from the issued state with pkce", func(t *testing.T) {
		t.Parallel()
		ctrl := gomock.NewController(t)
		connections := servicemocks.NewMockIDPConnectionService(ctrl)
		connections.EXPECT().GetBySlugs(gomock.Any(), "proj-1", []string{"google"}).
			Return([]*domain.IDPConnection{{Slug: "google", RevisionID: "idprev_1", Document: ssoConnectionDocument(true)}}, nil)
		keys := servicemocks.NewMockKeyService(ctrl)
		crypter := cryptomock.NewMockCrypter(ctrl)
		keys.EXPECT().GetProjectCrypter(gomock.Any(), "proj-1", domain.EncryptionKeyPurposeSecret).Return(crypter, nil)
		attempts := &fakeAuthAttempts{issueSSOState: &domain.SSOState{
			State:        "state-1",
			PKCEVerifier: "verifier-1",
			BindingNonce: "bind-1",
			OIDCNonce:    "nonce-1",
		}}

		out, err := service.NewFlowSSORedirectIssuer(connections, attempts, keys, servicemocks.NewMockVariableService(ctrl), &http.Client{}).Issue(t.Context(), ssoIssueInput)
		require.NoError(t, err)

		assert.Equal(t, service.IssueSSOStateInput{
			ProjectID:            "proj-1",
			AttemptID:            "attempt-1",
			ProviderSlug:         "google",
			ConnectionRevisionID: "idprev_1",
			RedirectURI:          ssoIssueInput.RedirectURI,
			ReturnTarget:         ssoIssueInput.ReturnTarget,
			PKCEEncrypter:        crypter,
		}, attempts.issueSSOStateIn)
		assert.Equal(t, "bind-1", out.BindingNonce)
		u, err := url.Parse(out.RedirectURL)
		require.NoError(t, err)
		assert.Equal(t, "https://accounts.example.test/authorize", u.Scheme+"://"+u.Host+u.Path)
		assert.Equal(t, url.Values{
			"client_id":             {"client-1"},
			"redirect_uri":          {ssoIssueInput.RedirectURI},
			"response_type":         {"code"},
			"scope":                 {"openid email"},
			"state":                 {"state-1"},
			"nonce":                 {"nonce-1"},
			"code_challenge":        {oidc.NewSHACodeChallenge("verifier-1")},
			"code_challenge_method": {"S256"},
		}, u.Query())
	})

	t.Run("a client_id reference is filled from the project variable", func(t *testing.T) {
		t.Parallel()
		ctrl := gomock.NewController(t)
		doc := strings.Replace(string(ssoConnectionDocument(false)), `"client-1"`, `"${{ GOOGLE_CLIENT_ID }}"`, 1)
		connections := servicemocks.NewMockIDPConnectionService(ctrl)
		connections.EXPECT().GetBySlugs(gomock.Any(), "proj-1", []string{"google"}).
			Return([]*domain.IDPConnection{{Slug: "google", RevisionID: "idprev_1", Document: []byte(doc)}}, nil)
		variables := servicemocks.NewMockVariableService(ctrl)
		variables.EXPECT().GetVariables(gomock.Any(), domain.VariableOwner{ProjectID: "proj-1"}, "GOOGLE_CLIENT_ID").
			Return([]*domain.Variable{{Name: "GOOGLE_CLIENT_ID", Value: "client-from-variable"}}, nil)
		attempts := &fakeAuthAttempts{issueSSOState: &domain.SSOState{State: "state-1", BindingNonce: "bind-1", OIDCNonce: "nonce-1"}}

		out, err := service.NewFlowSSORedirectIssuer(connections, attempts, servicemocks.NewMockKeyService(ctrl), variables, &http.Client{}).Issue(t.Context(), ssoIssueInput)
		require.NoError(t, err)

		u, err := url.Parse(out.RedirectURL)
		require.NoError(t, err)
		assert.Equal(t, "client-from-variable", u.Query().Get("client_id"))
	})

	t.Run("a client_id reference with no variable is unavailable and issues no record", func(t *testing.T) {
		t.Parallel()
		ctrl := gomock.NewController(t)
		doc := strings.Replace(string(ssoConnectionDocument(false)), `"client-1"`, `"${{ GOOGLE_CLIENT_ID }}"`, 1)
		connections := servicemocks.NewMockIDPConnectionService(ctrl)
		connections.EXPECT().GetBySlugs(gomock.Any(), "proj-1", []string{"google"}).
			Return([]*domain.IDPConnection{{Slug: "google", RevisionID: "idprev_1", Document: []byte(doc)}}, nil)
		variables := servicemocks.NewMockVariableService(ctrl)
		variables.EXPECT().GetVariables(gomock.Any(), domain.VariableOwner{ProjectID: "proj-1"}, "GOOGLE_CLIENT_ID").Return(nil, nil)
		attempts := &fakeAuthAttempts{}

		_, err := service.NewFlowSSORedirectIssuer(connections, attempts, servicemocks.NewMockKeyService(ctrl), variables, &http.Client{}).Issue(t.Context(), ssoIssueInput)
		require.ErrorIs(t, err, domain.ErrFlowSSOUnavailable(nil))
		assert.Empty(t, attempts.issueSSOStateIn.AttemptID)
	})

	t.Run("a client_id reference to a secret is unavailable and issues no record", func(t *testing.T) {
		t.Parallel()
		ctrl := gomock.NewController(t)
		doc := strings.Replace(string(ssoConnectionDocument(false)), `"client-1"`, `"${{ GOOGLE_CLIENT_ID }}"`, 1)
		connections := servicemocks.NewMockIDPConnectionService(ctrl)
		connections.EXPECT().GetBySlugs(gomock.Any(), "proj-1", []string{"google"}).
			Return([]*domain.IDPConnection{{Slug: "google", RevisionID: "idprev_1", Document: []byte(doc)}}, nil)
		variables := servicemocks.NewMockVariableService(ctrl)
		variables.EXPECT().GetVariables(gomock.Any(), domain.VariableOwner{ProjectID: "proj-1"}, "GOOGLE_CLIENT_ID").
			Return([]*domain.Variable{{Name: "GOOGLE_CLIENT_ID", Value: "ciphertext", IsSecret: true}}, nil)
		attempts := &fakeAuthAttempts{}

		_, err := service.NewFlowSSORedirectIssuer(connections, attempts, servicemocks.NewMockKeyService(ctrl), variables, &http.Client{}).Issue(t.Context(), ssoIssueInput)
		require.ErrorIs(t, err, domain.ErrFlowSSOUnavailable(nil))
		assert.Empty(t, attempts.issueSSOStateIn.AttemptID)
	})

	t.Run("without pkce no crypter is read and no challenge is sent", func(t *testing.T) {
		t.Parallel()
		ctrl := gomock.NewController(t)
		connections := servicemocks.NewMockIDPConnectionService(ctrl)
		connections.EXPECT().GetBySlugs(gomock.Any(), "proj-1", []string{"google"}).
			Return([]*domain.IDPConnection{{Slug: "google", RevisionID: "idprev_1", Document: ssoConnectionDocument(false)}}, nil)
		attempts := &fakeAuthAttempts{issueSSOState: &domain.SSOState{State: "state-1", BindingNonce: "bind-1", OIDCNonce: "nonce-1"}}

		out, err := service.NewFlowSSORedirectIssuer(connections, attempts, servicemocks.NewMockKeyService(ctrl), servicemocks.NewMockVariableService(ctrl), &http.Client{}).Issue(t.Context(), ssoIssueInput)
		require.NoError(t, err)

		assert.Nil(t, attempts.issueSSOStateIn.PKCEEncrypter)
		u, err := url.Parse(out.RedirectURL)
		require.NoError(t, err)
		assert.NotContains(t, u.Query(), "code_challenge")
		assert.Equal(t, "state-1", u.Query().Get("state"))
	})

	t.Run("unknown slug is not found and issues no record", func(t *testing.T) {
		t.Parallel()
		ctrl := gomock.NewController(t)
		connections := servicemocks.NewMockIDPConnectionService(ctrl)
		connections.EXPECT().GetBySlugs(gomock.Any(), "proj-1", []string{"google"}).Return(nil, nil)
		attempts := &fakeAuthAttempts{}

		_, err := service.NewFlowSSORedirectIssuer(connections, attempts, servicemocks.NewMockKeyService(ctrl), servicemocks.NewMockVariableService(ctrl), &http.Client{}).Issue(t.Context(), ssoIssueInput)
		require.ErrorIs(t, err, domain.ErrIDPConnectionNotFound())
		assert.Empty(t, attempts.issueSSOStateIn.AttemptID)
	})

	t.Run("discovery failure is unavailable with the engine error as cause and issues no record", func(t *testing.T) {
		t.Parallel()
		ctrl := gomock.NewController(t)
		connections := servicemocks.NewMockIDPConnectionService(ctrl)
		connections.EXPECT().GetBySlugs(gomock.Any(), "proj-1", []string{"google"}).
			Return([]*domain.IDPConnection{{Slug: "google", RevisionID: "idprev_1", Document: []byte(`{
				"slug": "google", "protocol": "oidc", "display_name": "Google",
				"oidc": {"issuer": "https://accounts.example.test", "client_id": "client-1", "client_secret": "s", "scopes": ["openid"]}
			}`)}}, nil)
		attempts := &fakeAuthAttempts{}

		_, err := service.NewFlowSSORedirectIssuer(connections, attempts, servicemocks.NewMockKeyService(ctrl), servicemocks.NewMockVariableService(ctrl), &http.Client{Transport: failingTransport{}}).Issue(t.Context(), ssoIssueInput)
		require.ErrorIs(t, err, domain.ErrFlowSSOUnavailable(nil))
		require.ErrorIs(t, err, domain.ErrIDPDiscoveryFailed(nil))
		assert.Empty(t, attempts.issueSSOStateIn.AttemptID)
	})

	t.Run("document breaking a protocol rule is unavailable", func(t *testing.T) {
		t.Parallel()
		ctrl := gomock.NewController(t)
		connections := servicemocks.NewMockIDPConnectionService(ctrl)
		connections.EXPECT().GetBySlugs(gomock.Any(), "proj-1", []string{"google"}).
			Return([]*domain.IDPConnection{{Slug: "google", RevisionID: "idprev_1", Document: []byte(`{
				"slug": "google", "protocol": "oidc", "display_name": "Google",
				"oidc": {"issuer": "https://accounts.example.test", "client_id": "client-1", "client_secret": "s", "scopes": ["email"]}
			}`)}}, nil)

		_, err := service.NewFlowSSORedirectIssuer(connections, &fakeAuthAttempts{}, servicemocks.NewMockKeyService(ctrl), servicemocks.NewMockVariableService(ctrl), &http.Client{}).Issue(t.Context(), ssoIssueInput)
		require.ErrorIs(t, err, domain.ErrFlowSSOUnavailable(nil))
		require.ErrorIs(t, err, domain.ErrIDPScopesMissingOpenID())
	})

	t.Run("undecodable document is internal, not unavailable", func(t *testing.T) {
		t.Parallel()
		ctrl := gomock.NewController(t)
		connections := servicemocks.NewMockIDPConnectionService(ctrl)
		connections.EXPECT().GetBySlugs(gomock.Any(), "proj-1", []string{"google"}).
			Return([]*domain.IDPConnection{{Slug: "google", RevisionID: "idprev_1", Document: []byte(`{`)}}, nil)

		_, err := service.NewFlowSSORedirectIssuer(connections, &fakeAuthAttempts{}, servicemocks.NewMockKeyService(ctrl), servicemocks.NewMockVariableService(ctrl), &http.Client{}).Issue(t.Context(), ssoIssueInput)
		require.ErrorIs(t, err, domain.ErrInternal(nil))
		assert.NotErrorIs(t, err, domain.ErrFlowSSOUnavailable(nil))
	})

	t.Run("a cancelled request is unavailable without a provider warning", func(t *testing.T) {
		t.Parallel()
		ctrl := gomock.NewController(t)
		connections := servicemocks.NewMockIDPConnectionService(ctrl)
		connections.EXPECT().GetBySlugs(gomock.Any(), "proj-1", []string{"google"}).
			Return([]*domain.IDPConnection{{Slug: "google", RevisionID: "idprev_1", Document: []byte(`{
				"slug": "google", "protocol": "oidc", "display_name": "Google",
				"oidc": {"issuer": "https://accounts.example.test", "client_id": "client-1", "client_secret": "s", "scopes": ["openid"]}
			}`)}}, nil)
		var logs bytes.Buffer
		ctx, cancel := context.WithCancel(zlog.WithLoggingContext(t.Context(), slog.New(slog.NewTextHandler(&logs, nil))))
		cancel()

		_, err := service.NewFlowSSORedirectIssuer(connections, &fakeAuthAttempts{}, servicemocks.NewMockKeyService(ctrl), servicemocks.NewMockVariableService(ctrl), &http.Client{}).Issue(ctx, ssoIssueInput)
		require.ErrorIs(t, err, domain.ErrFlowSSOUnavailable(nil))
		require.ErrorIs(t, err, context.Canceled)
		assert.Empty(t, logs.String())
	})

	t.Run("attempt error passes through", func(t *testing.T) {
		t.Parallel()
		ctrl := gomock.NewController(t)
		connections := servicemocks.NewMockIDPConnectionService(ctrl)
		connections.EXPECT().GetBySlugs(gomock.Any(), "proj-1", []string{"google"}).
			Return([]*domain.IDPConnection{{Slug: "google", RevisionID: "idprev_1", Document: ssoConnectionDocument(false)}}, nil)
		attempts := &fakeAuthAttempts{issueSSOStateErr: domain.ErrAuthAttemptAlreadyHandedOff()}

		_, err := service.NewFlowSSORedirectIssuer(connections, attempts, servicemocks.NewMockKeyService(ctrl), servicemocks.NewMockVariableService(ctrl), &http.Client{}).Issue(t.Context(), ssoIssueInput)
		require.ErrorIs(t, err, domain.ErrAuthAttemptAlreadyHandedOff())
	})
}
