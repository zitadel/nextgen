package service_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

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
			"pkce_enabled": ` + strconv.FormatBool(pkce) + `,
			"authorization_endpoint": "https://accounts.example.test/authorize",
			"token_endpoint": "https://accounts.example.test/token",
			"userinfo_endpoint": "https://accounts.example.test/userinfo",
			"jwks_uri": "https://accounts.example.test/keys"
		}
	}`
	return []byte(doc)
}

// ssoClientIDReferenceDocument is the static connection with its client_id
// pointing at a project variable.
var ssoClientIDReferenceDocument = []byte(strings.Replace(string(ssoConnectionDocument(false)), `"client-1"`, `"${{ GOOGLE_CLIENT_ID }}"`, 1))

// ssoDiscoveryDocument has no endpoints, so building the client fetches the
// issuer's discovery document.
const ssoDiscoveryDocument = `{
	"slug": "google", "protocol": "oidc", "display_name": "Google",
	"oidc": {"issuer": "https://accounts.example.test", "client_id": "client-1", "client_secret": "s", "scopes": ["openid"]}
}`

var ssoIssueInput = domain.FlowIssueSSORedirectInput{
	ProjectID:    "proj-1",
	AttemptID:    "attempt-1",
	ProviderSlug: "google",
	FlowSSOReturn: domain.FlowSSOReturn{
		RedirectURI:  "https://auth.example.com/__nextgen/idp/google/callback",
		ReturnTarget: "https://auth.example.com/login?flow=flow-1",
	},
}

// failingTransport stands in for an unreachable provider.
type failingTransport struct{}

func (failingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("dial tcp: connection refused")
}

// ssoIssuer builds the issuer over a connection service that answers the
// slug with document, nil meaning no connection. A dependency left nil gets
// a mock that expects no call.
func ssoIssuer(t *testing.T, document []byte, attempts *fakeAuthAttempts, keys service.KeyService, variables service.VariableService, client *http.Client) *service.FlowSSORedirectIssuer {
	t.Helper()
	ctrl := gomock.NewController(t)
	connections := servicemocks.NewMockIDPConnectionService(ctrl)
	var found []*domain.IDPConnection
	if document != nil {
		found = []*domain.IDPConnection{{Slug: "google", RevisionID: "idprev_1", Document: document}}
	}
	connections.EXPECT().GetBySlugs(gomock.Any(), "proj-1", []string{"google"}).Return(found, nil)
	if keys == nil {
		keys = servicemocks.NewMockKeyService(ctrl)
	}
	if variables == nil {
		variables = servicemocks.NewMockVariableService(ctrl)
	}
	if client == nil {
		client = &http.Client{}
	}
	return service.NewFlowSSORedirectIssuer(connections, attempts, keys, variables, client)
}

func TestFlowSSORedirectIssuer_Issue(t *testing.T) {
	t.Parallel()

	t.Run("builds the authorize url from the issued state with pkce", func(t *testing.T) {
		t.Parallel()
		ctrl := gomock.NewController(t)
		keys := servicemocks.NewMockKeyService(ctrl)
		crypter := cryptomock.NewMockCrypter(ctrl)
		keys.EXPECT().GetProjectCrypter(gomock.Any(), "proj-1", domain.EncryptionKeyPurposeSecret).Return(crypter, nil)
		attempts := &fakeAuthAttempts{issueSSOState: &domain.SSOState{
			State:        "state-1",
			PKCEVerifier: "verifier-1",
			BindingNonce: "bind-1",
			OIDCNonce:    "nonce-1",
		}}

		out, err := ssoIssuer(t, ssoConnectionDocument(true), attempts, keys, nil, nil).Issue(t.Context(), ssoIssueInput)
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
		variables := servicemocks.NewMockVariableService(gomock.NewController(t))
		variables.EXPECT().GetVariables(gomock.Any(), domain.VariableOwner{ProjectID: "proj-1"}, "GOOGLE_CLIENT_ID").
			Return([]*domain.Variable{{Name: "GOOGLE_CLIENT_ID", Value: "client-from-variable"}}, nil)
		attempts := &fakeAuthAttempts{issueSSOState: &domain.SSOState{State: "state-1", BindingNonce: "bind-1", OIDCNonce: "nonce-1"}}

		out, err := ssoIssuer(t, ssoClientIDReferenceDocument, attempts, nil, variables, nil).Issue(t.Context(), ssoIssueInput)
		require.NoError(t, err)

		u, err := url.Parse(out.RedirectURL)
		require.NoError(t, err)
		assert.Equal(t, "client-from-variable", u.Query().Get("client_id"))
	})

	t.Run("a client_id reference with no variable is unavailable and issues no record", func(t *testing.T) {
		t.Parallel()
		variables := servicemocks.NewMockVariableService(gomock.NewController(t))
		variables.EXPECT().GetVariables(gomock.Any(), domain.VariableOwner{ProjectID: "proj-1"}, "GOOGLE_CLIENT_ID").Return(nil, nil)
		attempts := &fakeAuthAttempts{}

		_, err := ssoIssuer(t, ssoClientIDReferenceDocument, attempts, nil, variables, nil).Issue(t.Context(), ssoIssueInput)
		require.ErrorIs(t, err, domain.ErrFlowSSOUnavailable(nil))
		assert.Empty(t, attempts.issueSSOStateIn.AttemptID)
	})

	t.Run("a client_id reference to a secret is unavailable and issues no record", func(t *testing.T) {
		t.Parallel()
		variables := servicemocks.NewMockVariableService(gomock.NewController(t))
		variables.EXPECT().GetVariables(gomock.Any(), domain.VariableOwner{ProjectID: "proj-1"}, "GOOGLE_CLIENT_ID").
			Return([]*domain.Variable{{Name: "GOOGLE_CLIENT_ID", Value: "ciphertext", IsSecret: true}}, nil)
		attempts := &fakeAuthAttempts{}

		_, err := ssoIssuer(t, ssoClientIDReferenceDocument, attempts, nil, variables, nil).Issue(t.Context(), ssoIssueInput)
		require.ErrorIs(t, err, domain.ErrFlowSSOUnavailable(nil))
		assert.Empty(t, attempts.issueSSOStateIn.AttemptID)
	})

	t.Run("without pkce no crypter is read and no challenge is sent", func(t *testing.T) {
		t.Parallel()
		attempts := &fakeAuthAttempts{issueSSOState: &domain.SSOState{State: "state-1", BindingNonce: "bind-1", OIDCNonce: "nonce-1"}}

		out, err := ssoIssuer(t, ssoConnectionDocument(false), attempts, nil, nil, nil).Issue(t.Context(), ssoIssueInput)
		require.NoError(t, err)

		assert.Nil(t, attempts.issueSSOStateIn.PKCEEncrypter)
		u, err := url.Parse(out.RedirectURL)
		require.NoError(t, err)
		assert.NotContains(t, u.Query(), "code_challenge")
		assert.Equal(t, "state-1", u.Query().Get("state"))
	})

	t.Run("unknown slug is not found and issues no record", func(t *testing.T) {
		t.Parallel()
		attempts := &fakeAuthAttempts{}

		_, err := ssoIssuer(t, nil, attempts, nil, nil, nil).Issue(t.Context(), ssoIssueInput)
		require.ErrorIs(t, err, domain.ErrIDPConnectionNotFound())
		assert.Empty(t, attempts.issueSSOStateIn.AttemptID)
	})

	t.Run("discovery failure is unavailable with the engine error as cause and issues no record", func(t *testing.T) {
		t.Parallel()
		attempts := &fakeAuthAttempts{}

		_, err := ssoIssuer(t, []byte(ssoDiscoveryDocument), attempts, nil, nil, &http.Client{Transport: failingTransport{}}).Issue(t.Context(), ssoIssueInput)
		require.ErrorIs(t, err, domain.ErrFlowSSOUnavailable(nil))
		require.ErrorIs(t, err, domain.ErrIDPDiscoveryFailed(nil))
		assert.Empty(t, attempts.issueSSOStateIn.AttemptID)
	})

	t.Run("document breaking a protocol rule is unavailable", func(t *testing.T) {
		t.Parallel()
		doc := strings.Replace(ssoDiscoveryDocument, `["openid"]`, `["email"]`, 1)

		_, err := ssoIssuer(t, []byte(doc), &fakeAuthAttempts{}, nil, nil, nil).Issue(t.Context(), ssoIssueInput)
		require.ErrorIs(t, err, domain.ErrFlowSSOUnavailable(nil))
		require.ErrorIs(t, err, domain.ErrIDPScopesMissingOpenID())
	})

	t.Run("undecodable document is internal, not unavailable", func(t *testing.T) {
		t.Parallel()

		_, err := ssoIssuer(t, []byte(`{`), &fakeAuthAttempts{}, nil, nil, nil).Issue(t.Context(), ssoIssueInput)
		require.ErrorIs(t, err, domain.ErrInternal(nil))
		assert.NotErrorIs(t, err, domain.ErrFlowSSOUnavailable(nil))
	})

	t.Run("a cancelled request is unavailable without a provider warning", func(t *testing.T) {
		t.Parallel()
		var logs bytes.Buffer
		ctx, cancel := context.WithCancel(zlog.WithLoggingContext(t.Context(), slog.New(slog.NewTextHandler(&logs, nil))))
		cancel()

		_, err := ssoIssuer(t, []byte(ssoDiscoveryDocument), &fakeAuthAttempts{}, nil, nil, nil).Issue(ctx, ssoIssueInput)
		require.ErrorIs(t, err, domain.ErrFlowSSOUnavailable(nil))
		require.ErrorIs(t, err, context.Canceled)
		assert.Empty(t, logs.String())
	})

	t.Run("a request past its deadline is unavailable with a provider warning", func(t *testing.T) {
		t.Parallel()
		var logs bytes.Buffer
		ctx, cancel := context.WithDeadline(zlog.WithLoggingContext(t.Context(), slog.New(slog.NewTextHandler(&logs, nil))), time.Now().Add(-time.Second))
		defer cancel()

		_, err := ssoIssuer(t, []byte(ssoDiscoveryDocument), &fakeAuthAttempts{}, nil, nil, nil).Issue(ctx, ssoIssueInput)
		require.ErrorIs(t, err, domain.ErrFlowSSOUnavailable(nil))
		assert.Contains(t, logs.String(), "sso provider unavailable")
	})

	t.Run("attempt error passes through", func(t *testing.T) {
		t.Parallel()
		attempts := &fakeAuthAttempts{issueSSOStateErr: domain.ErrAuthAttemptAlreadyHandedOff()}

		_, err := ssoIssuer(t, ssoConnectionDocument(false), attempts, nil, nil, nil).Issue(t.Context(), ssoIssueInput)
		require.ErrorIs(t, err, domain.ErrAuthAttemptAlreadyHandedOff())
	})
}
