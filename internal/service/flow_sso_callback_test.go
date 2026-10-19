package service_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	jose "github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/ssoevent"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
)

const ssoCallbackState = "proj-1.random-part"

// ssoCallbackSlug is the connection ssoCallbackPending pins; a callback on any
// other connection's path is a mix-up.
const ssoCallbackSlug = "google"

func ssoCallbackPending() *domain.SSOStatePayload {
	return &domain.SSOStatePayload{
		ProviderSlug:         ssoCallbackSlug,
		ConnectionRevisionID: "idprev_1",
		RedirectURI:          "https://auth.example.com/__nextgen/idp/google/callback",
		OIDCNonce:            "the-nonce",
		ReturnTarget:         "https://app.example.com/login?flow=flow-1",
	}
}

// tripwireTransport fails the test on any request: no table case may reach
// the provider.
type tripwireTransport struct{ t *testing.T }

func (tr tripwireTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	tr.t.Errorf("unexpected request to the provider: %s %s", r.Method, r.URL)
	return nil, errors.New("unexpected request")
}

func TestFlowSSOCallback_Process(t *testing.T) {
	t.Parallel()

	revisionDoc := ssoConnectionDocument(false)
	tests := []struct {
		name          string
		in            service.FlowSSOCallbackInput
		consumeErr    error
		setResultErrs []error
		connections   func(m *servicemocks.MockIDPConnectionService)
		variables     func(m *servicemocks.MockVariableService)
		wantErr       error
		// wantResult is what must have been stored on the record; nil means
		// nothing was stored.
		wantResult *domain.SSOCallbackResult
		// wantEvent is the event the stored result was written with.
		wantEvent domain.EventType
	}{
		{
			name:    "a state without a project part is invalid and never looked up",
			in:      service.FlowSSOCallbackInput{State: "no-separator", Code: "the-code"},
			wantErr: domain.ErrSSOStateInvalid(),
		},
		{
			name:       "a consume failure passes through",
			in:         service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Code: "the-code"},
			consumeErr: domain.ErrSSOStateInvalid(),
			wantErr:    domain.ErrSSOStateInvalid(),
		},
		{
			name:       "access_denied stores the cancelled key",
			in:         service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Error: "access_denied", ErrorDescription: "the provider's words"},
			wantResult: &domain.SSOCallbackResult{ErrorKey: domain.FlowStepErrorSSOCancelled},
			wantEvent:  domain.EventTypeAuthSSOAuthorizationFailed,
		},
		{
			name:       "every other provider code stores the failed key",
			in:         service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Error: "temporarily_unavailable"},
			wantResult: &domain.SSOCallbackResult{ErrorKey: domain.FlowStepErrorSSOFailed},
			wantEvent:  domain.EventTypeAuthSSOAuthorizationFailed,
		},
		{
			name:       "neither code nor error stores the failed key",
			in:         service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState},
			wantResult: &domain.SSOCallbackResult{ErrorKey: domain.FlowStepErrorSSOFailed},
			wantEvent:  domain.EventTypeAuthSSOAuthorizationFailed,
		},
		{
			// The mix-up attack (RFC 9700 §4.4): another connection's provider
			// sent the browser here. Its code must not reach the pinned
			// connection's token endpoint, so the revision is never loaded.
			// A code arrived, so the refusal is an exchange failure.
			name:       "a path naming another connection stores the failed key without a token request",
			in:         service.FlowSSOCallbackInput{ConnectionSlug: "other", State: ssoCallbackState, Code: "the-code"},
			wantResult: &domain.SSOCallbackResult{ErrorKey: domain.FlowStepErrorSSOFailed},
			wantEvent:  domain.EventTypeAuthSSOExchangeFailed,
		},
		{
			// No code arrived, so the refusal is an authorization failure, and
			// the provider's error is not what the user sees: the answer is
			// not the pinned connection's.
			name:       "a provider error on another connection's path stores the failed key",
			in:         service.FlowSSOCallbackInput{ConnectionSlug: "other", State: ssoCallbackState, Error: "access_denied"},
			wantResult: &domain.SSOCallbackResult{ErrorKey: domain.FlowStepErrorSSOFailed},
			wantEvent:  domain.EventTypeAuthSSOAuthorizationFailed,
		},
		{
			name:       "a path naming no connection stores the failed key",
			in:         service.FlowSSOCallbackInput{State: ssoCallbackState, Code: "the-code"},
			wantResult: &domain.SSOCallbackResult{ErrorKey: domain.FlowStepErrorSSOFailed},
			wantEvent:  domain.EventTypeAuthSSOExchangeFailed,
		},
		{
			// RFC 9207: a provider registered with a wildcard redirect URI can
			// answer on the pinned connection's path, and its iss gives it
			// away. The revision is read for the issuer; nothing else is.
			name: "an iss that is not the connection's issuer stores the failed key without a token request",
			in:   service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Code: "the-code", Issuer: "https://evil.example.test"},
			connections: func(m *servicemocks.MockIDPConnectionService) {
				m.EXPECT().GetRevision(gomock.Any(), "proj-1", "idprev_1").
					Return(&domain.IDPConnection{Slug: ssoCallbackSlug, RevisionID: "idprev_1", Document: revisionDoc}, nil)
			},
			wantResult: &domain.SSOCallbackResult{ErrorKey: domain.FlowStepErrorSSOFailed},
			wantEvent:  domain.EventTypeAuthSSOExchangeFailed,
		},
		{
			// The provider's error is not read: it is not the pinned
			// connection's answer, so the user sees the failure, not a
			// cancellation. No code arrived, so it is an authorization failure.
			name: "a provider error with a foreign iss stores the failed key",
			in:   service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Error: "access_denied", Issuer: "https://evil.example.test"},
			connections: func(m *servicemocks.MockIDPConnectionService) {
				m.EXPECT().GetRevision(gomock.Any(), "proj-1", "idprev_1").
					Return(&domain.IDPConnection{Slug: ssoCallbackSlug, RevisionID: "idprev_1", Document: revisionDoc}, nil)
			},
			wantResult: &domain.SSOCallbackResult{ErrorKey: domain.FlowStepErrorSSOFailed},
			wantEvent:  domain.EventTypeAuthSSOAuthorizationFailed,
		},
		{
			name: "a provider error with the connection's iss is read as usual",
			in:   service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Error: "access_denied", Issuer: "https://accounts.example.test"},
			connections: func(m *servicemocks.MockIDPConnectionService) {
				m.EXPECT().GetRevision(gomock.Any(), "proj-1", "idprev_1").
					Return(&domain.IDPConnection{Slug: ssoCallbackSlug, RevisionID: "idprev_1", Document: revisionDoc}, nil)
			},
			wantResult: &domain.SSOCallbackResult{ErrorKey: domain.FlowStepErrorSSOCancelled},
			wantEvent:  domain.EventTypeAuthSSOAuthorizationFailed,
		},
		{
			// No token request follows an error response, so the unchecked
			// iss costs nothing, and the person's answer is kept.
			name: "a provider error whose revision cannot be read for the iss check is read as usual",
			in:   service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Error: "access_denied", Issuer: "https://accounts.example.test"},
			connections: func(m *servicemocks.MockIDPConnectionService) {
				m.EXPECT().GetRevision(gomock.Any(), "proj-1", "idprev_1").Return(nil, domain.ErrIDPConnectionNotFound())
			},
			wantResult: &domain.SSOCallbackResult{ErrorKey: domain.FlowStepErrorSSOCancelled},
			wantEvent:  domain.EventTypeAuthSSOAuthorizationFailed,
		},
		{
			name: "a code whose revision cannot be read for the iss check stores the failed key",
			in:   service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Code: "the-code", Issuer: "https://accounts.example.test"},
			connections: func(m *servicemocks.MockIDPConnectionService) {
				m.EXPECT().GetRevision(gomock.Any(), "proj-1", "idprev_1").Return(nil, domain.ErrIDPConnectionNotFound())
			},
			wantResult: &domain.SSOCallbackResult{ErrorKey: domain.FlowStepErrorSSOFailed},
			wantEvent:  domain.EventTypeAuthSSOExchangeFailed,
		},
		{
			name: "a vanished revision stores the failed key",
			in:   service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Code: "the-code"},
			connections: func(m *servicemocks.MockIDPConnectionService) {
				m.EXPECT().GetRevision(gomock.Any(), "proj-1", "idprev_1").Return(nil, domain.ErrIDPConnectionNotFound())
			},
			wantResult: &domain.SSOCallbackResult{ErrorKey: domain.FlowStepErrorSSOFailed},
			wantEvent:  domain.EventTypeAuthSSOExchangeFailed,
		},
		{
			name: "a missing client_secret variable stores the failed key without a token request",
			in:   service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Code: "the-code"},
			connections: func(m *servicemocks.MockIDPConnectionService) {
				m.EXPECT().GetRevision(gomock.Any(), "proj-1", "idprev_1").
					Return(&domain.IDPConnection{Slug: "google", RevisionID: "idprev_1", Document: revisionDoc}, nil)
			},
			variables: func(m *servicemocks.MockVariableService) {
				m.EXPECT().GetDecryptedVariables(gomock.Any(), domain.VariableOwner{ProjectID: "proj-1"}, new(domain.DeploymentOriginKindPrimary), "GOOGLE_SECRET").Return(nil, nil)
			},
			wantResult: &domain.SSOCallbackResult{ErrorKey: domain.FlowStepErrorSSOFailed},
			wantEvent:  domain.EventTypeAuthSSOExchangeFailed,
		},
		{
			name: "a client_secret variable not marked secret stores the failed key without a token request",
			in:   service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Code: "the-code"},
			connections: func(m *servicemocks.MockIDPConnectionService) {
				m.EXPECT().GetRevision(gomock.Any(), "proj-1", "idprev_1").
					Return(&domain.IDPConnection{Slug: "google", RevisionID: "idprev_1", Document: revisionDoc}, nil)
			},
			variables: func(m *servicemocks.MockVariableService) {
				m.EXPECT().GetDecryptedVariables(gomock.Any(), domain.VariableOwner{ProjectID: "proj-1"}, new(domain.DeploymentOriginKindPrimary), "GOOGLE_SECRET").
					Return([]*domain.Variable{{Name: "GOOGLE_SECRET", Value: "plain", IsSecret: false}}, nil)
			},
			wantResult: &domain.SSOCallbackResult{ErrorKey: domain.FlowStepErrorSSOFailed},
			wantEvent:  domain.EventTypeAuthSSOExchangeFailed,
		},
		{
			name: "a literal client_secret stores the failed key without a token request",
			in:   service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Code: "the-code"},
			connections: func(m *servicemocks.MockIDPConnectionService) {
				doc := bytes.Replace(revisionDoc, []byte(`"${{ GOOGLE_SECRET }}"`), []byte(`"pasted-secret"`), 1)
				m.EXPECT().GetRevision(gomock.Any(), "proj-1", "idprev_1").
					Return(&domain.IDPConnection{Slug: "google", RevisionID: "idprev_1", Document: doc}, nil)
			},
			wantResult: &domain.SSOCallbackResult{ErrorKey: domain.FlowStepErrorSSOFailed},
			wantEvent:  domain.EventTypeAuthSSOExchangeFailed,
		},
		{
			name: "an internal failure stores the failed key",
			in:   service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Code: "the-code"},
			connections: func(m *servicemocks.MockIDPConnectionService) {
				m.EXPECT().GetRevision(gomock.Any(), "proj-1", "idprev_1").Return(nil, domain.ErrInternal(errors.New("db down")))
			},
			wantResult: &domain.SSOCallbackResult{ErrorKey: domain.FlowStepErrorSSOFailed},
			wantEvent:  domain.EventTypeAuthSSOExchangeFailed,
		},
		{
			name:          "a refused result write passes through",
			in:            service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Error: "access_denied"},
			setResultErrs: []error{domain.ErrSSOStateInvalid()},
			wantErr:       domain.ErrSSOStateInvalid(),
			wantResult:    &domain.SSOCallbackResult{ErrorKey: domain.FlowStepErrorSSOCancelled},
			wantEvent:     domain.EventTypeAuthSSOAuthorizationFailed,
		},
		{
			name: "a failed write of the failed key passes through",
			in:   service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Code: "the-code"},
			connections: func(m *servicemocks.MockIDPConnectionService) {
				m.EXPECT().GetRevision(gomock.Any(), "proj-1", "idprev_1").Return(nil, domain.ErrInternal(errors.New("db down")))
			},
			setResultErrs: []error{domain.ErrUnavailable()},
			wantErr:       domain.ErrUnavailable(),
			wantResult:    &domain.SSOCallbackResult{ErrorKey: domain.FlowStepErrorSSOFailed},
			wantEvent:     domain.EventTypeAuthSSOExchangeFailed,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ctrl := gomock.NewController(t)
			connections := servicemocks.NewMockIDPConnectionService(ctrl)
			if tt.connections != nil {
				tt.connections(connections)
			}
			variables := servicemocks.NewMockVariableService(ctrl)
			if tt.variables != nil {
				tt.variables(variables)
			}
			attempts := &fakeAuthAttempts{
				consumeCheck:  &domain.SSOCallbackCheck{Pending: ssoCallbackPending()},
				consumeErr:    tt.consumeErr,
				setResultErrs: tt.setResultErrs,
			}
			svc := service.NewFlowSSOCallback(connections, attempts, servicemocks.NewMockKeyService(ctrl), variables, &http.Client{Transport: tripwireTransport{t}})

			out, err := svc.Process(t.Context(), tt.in)

			assert.Equal(t, tt.wantResult, attempts.setResult)
			assert.Equal(t, tt.wantEvent, attempts.setResultEvent)
			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, "https://app.example.com/login?flow=flow-1", out.ReturnTarget)
			assert.Same(t, attempts.consumeCheck, attempts.setResultCheck)
		})
	}
}

// A cancelled request is the client leaving and is stored without a warning.
// A deadline is not the client's doing and is still warned about.
func TestFlowSSOCallback_Process_WarnsUnlessCancelled(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		ctx      func(context.Context) (context.Context, context.CancelFunc)
		wantWarn bool
	}{
		{
			name: "cancelled",
			ctx: func(ctx context.Context) (context.Context, context.CancelFunc) {
				ctx, cancel := context.WithCancel(ctx)
				cancel()
				return ctx, cancel
			},
		},
		{
			name: "past its deadline",
			ctx: func(ctx context.Context) (context.Context, context.CancelFunc) {
				return context.WithDeadline(ctx, time.Now().Add(-time.Second))
			},
			wantWarn: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			var logs bytes.Buffer
			ctx, cancel := tt.ctx(zlog.WithLoggingContext(t.Context(), slog.New(slog.NewTextHandler(&logs, nil))))
			defer cancel()
			ctrl := gomock.NewController(t)
			connections := servicemocks.NewMockIDPConnectionService(ctrl)
			// A literal client_secret fails before any request, so the
			// outcome does not depend on the context reaching the network.
			doc := bytes.Replace(ssoConnectionDocument(false), []byte(`"${{ GOOGLE_SECRET }}"`), []byte(`"pasted-secret"`), 1)
			connections.EXPECT().GetRevision(gomock.Any(), "proj-1", "idprev_1").
				Return(&domain.IDPConnection{Slug: "google", RevisionID: "idprev_1", Document: doc}, nil)
			attempts := &fakeAuthAttempts{consumeCheck: &domain.SSOCallbackCheck{Pending: ssoCallbackPending()}}
			svc := service.NewFlowSSOCallback(connections, attempts, servicemocks.NewMockKeyService(ctrl), servicemocks.NewMockVariableService(ctrl), &http.Client{Transport: tripwireTransport{t}})

			_, err := svc.Process(ctx, service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Code: "the-code"})
			require.NoError(t, err)
			assert.Equal(t, tt.wantWarn, bytes.Contains(logs.Bytes(), []byte("sso callback failed")))
		})
	}
}

// The request is attributed to the project only once a record is consumed:
// until then, the project comes from the state's prefix alone.
func TestFlowSSOCallback_Process_BindsTheProjectAfterConsume(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name        string
		consumeErr  error
		wantProject string
	}{
		{name: "consumed", wantProject: "proj-1"},
		{name: "not consumed", consumeErr: domain.ErrSSOStateInvalid()},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ctx := audit.WithActorSlot(t.Context())
			ctrl := gomock.NewController(t)
			attempts := &fakeAuthAttempts{
				consumeCheck: &domain.SSOCallbackCheck{Pending: ssoCallbackPending()},
				consumeErr:   tt.consumeErr,
			}
			svc := service.NewFlowSSOCallback(servicemocks.NewMockIDPConnectionService(ctrl), attempts, servicemocks.NewMockKeyService(ctrl), servicemocks.NewMockVariableService(ctrl), &http.Client{Transport: tripwireTransport{t}})

			_, _ = svc.Process(ctx, service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Error: "access_denied"})

			slot, ok := audit.ActorSlotFromContext(ctx)
			require.True(t, ok)
			assert.Equal(t, tt.wantProject, slot.ProjectID)
		})
	}
}

// ssoCallbackProvider is a fake provider for the full exchange: /keys serves
// the signing key, /token checks the secret and answers a signed id_token.
func ssoCallbackProvider(t *testing.T) (doc []byte, issuer string) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/keys":
			_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
				{Key: &key.PublicKey, KeyID: "k1", Algorithm: "RS256", Use: "sig"},
			}})
		case "/token":
			user, pass, ok := r.BasicAuth()
			assert.True(t, ok, "the exchange must authenticate")
			assert.Equal(t, "client-1", user)
			assert.Equal(t, "secret-1", pass)
			require.NoError(t, r.ParseForm())
			assert.Equal(t, "the-code", r.PostForm.Get("code"))

			now := time.Now()
			payload, err := json.Marshal(map[string]any{
				"iss": srv.URL, "aud": "client-1", "sub": "user-1",
				"exp": now.Add(time.Hour).Unix(), "iat": now.Unix(), "nonce": "the-nonce",
			})
			require.NoError(t, err)
			signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithHeader("kid", "k1"))
			require.NoError(t, err)
			jws, err := signer.Sign(payload)
			require.NoError(t, err)
			token, err := jws.CompactSerialize()
			require.NoError(t, err)
			_, _ = fmt.Fprintf(w, `{"access_token":"the-access-token","token_type":"bearer","id_token":%q}`, token)
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	}))
	t.Cleanup(srv.Close)

	return []byte(`{
		"slug": "google",
		"protocol": "oidc",
		"display_name": "Google",
		"oidc": {
			"issuer": "` + srv.URL + `",
			"client_id": "client-1",
			"client_secret": "${{ GOOGLE_SECRET }}",
			"scopes": ["openid"],
			"id_token_mapping": true,
			"pkce_enabled": false,
			"authorization_endpoint": "` + srv.URL + `/authorize",
			"token_endpoint": "` + srv.URL + `/token",
			"userinfo_endpoint": "` + srv.URL + `/userinfo",
			"jwks_uri": "` + srv.URL + `/keys"
		}
	}`), srv.URL
}

func TestFlowSSOCallback_Process_StoresTheIdentity(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name          string
		setResultErrs []error
		// sendIssuer sends the connection's issuer as the RFC 9207 iss.
		sendIssuer bool
		wantErr    error
		// wantErrorKey is the key stored last; "" means the identity was.
		wantErrorKey string
		// wantEvent is the event the last write was made with.
		wantEvent domain.EventType
	}{
		{
			name:      "the identity is stored",
			wantEvent: domain.EventTypeAuthSSOExchangeSucceeded,
		},
		{
			name:       "an iss that is the connection's issuer is accepted",
			sendIssuer: true,
			wantEvent:  domain.EventTypeAuthSSOExchangeSucceeded,
		},
		{
			name:          "a failed identity write stores the failed key",
			setResultErrs: []error{domain.ErrUnavailable()},
			wantErrorKey:  domain.FlowStepErrorSSOFailed,
			wantEvent:     domain.EventTypeAuthSSOExchangeFailed,
		},
		{
			name:          "a failed write of the failed key passes through",
			setResultErrs: []error{domain.ErrUnavailable(), domain.ErrUnavailable()},
			wantErr:       domain.ErrUnavailable(),
			wantErrorKey:  domain.FlowStepErrorSSOFailed,
			wantEvent:     domain.EventTypeAuthSSOExchangeFailed,
		},
		{
			name:          "a refused identity write passes through without a second write",
			setResultErrs: []error{domain.ErrSSOStateInvalid()},
			wantErr:       domain.ErrSSOStateInvalid(),
			wantEvent:     domain.EventTypeAuthSSOExchangeSucceeded,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ctrl := gomock.NewController(t)
			doc, issuer := ssoCallbackProvider(t)
			connections := servicemocks.NewMockIDPConnectionService(ctrl)
			connections.EXPECT().GetRevision(gomock.Any(), "proj-1", "idprev_1").
				Return(&domain.IDPConnection{Slug: ssoCallbackSlug, RevisionID: "idprev_1", Document: doc}, nil)
			variables := servicemocks.NewMockVariableService(ctrl)
			variables.EXPECT().GetDecryptedVariables(gomock.Any(), domain.VariableOwner{ProjectID: "proj-1"}, new(domain.DeploymentOriginKindPrimary), "GOOGLE_SECRET").
				Return([]*domain.Variable{{Name: "GOOGLE_SECRET", Value: "secret-1", IsSecret: true}}, nil)
			attempts := &fakeAuthAttempts{
				consumeCheck:  &domain.SSOCallbackCheck{Pending: ssoCallbackPending()},
				setResultErrs: tt.setResultErrs,
			}
			svc := service.NewFlowSSOCallback(connections, attempts, servicemocks.NewMockKeyService(ctrl), variables, &http.Client{})

			in := service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Code: "the-code", BindingNonce: "bind-1"}
			if tt.sendIssuer {
				in.Issuer = issuer
			}
			out, err := svc.Process(t.Context(), in)

			assert.Equal(t, ssoCallbackState, attempts.consumeState)
			assert.Equal(t, "bind-1", attempts.consumeNonce)
			require.NotNil(t, attempts.setResult)
			assert.Equal(t, tt.wantErrorKey, attempts.setResult.ErrorKey)
			assert.Equal(t, tt.wantEvent, attempts.setResultEvent)
			if tt.wantErrorKey == "" {
				assert.Equal(t, "user-1", attempts.setResult.Subject)
				assert.Equal(t, "idprev_1", attempts.setResult.ConnectionRevisionID)
			}
			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, "https://app.example.com/login?flow=flow-1", out.ReturnTarget)
		})
	}
}

// Canary values: each stands for something the log must never carry. Every
// one is planted where the callback reads or the provider answers.
const (
	canaryCode   = "CANARY-AUTH-CODE"
	canaryState  = "proj-1.CANARY-STATE"
	canarySecret = "CANARY-CLIENT-SECRET"
	canaryToken  = "CANARY-ACCESS-TOKEN"
	canaryClaim  = "canary-claim@example.test"
	canaryText   = "CANARY-PROVIDER-TEXT"
)

// ssoEventRecords returns the sso attempt events a JSON log holds.
func ssoEventRecords(t *testing.T, logs []byte) []map[string]any {
	t.Helper()
	var events []map[string]any
	for _, line := range bytes.Split(bytes.TrimSpace(logs), []byte("\n")) {
		if len(line) == 0 {
			continue
		}
		var record map[string]any
		require.NoError(t, json.Unmarshal(line, &record))
		if record["msg"] == ssoevent.Message {
			events = append(events, record)
		}
	}
	return events
}

// ssoCanaryProvider is a fake provider whose token endpoint either fails with
// canary text or answers a signed id_token that carries the canary claim and
// the canary access token. The connection maps the email claim.
func ssoCanaryProvider(t *testing.T, failExchange bool) []byte {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/keys":
			_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
				{Key: &key.PublicKey, KeyID: "k1", Algorithm: "RS256", Use: "sig"},
			}})
		case "/token":
			if failExchange {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = fmt.Fprintf(w, `{"error":"invalid_grant","error_description":"%s %s %s"}`, canaryText, canaryCode, canarySecret)
				return
			}
			now := time.Now()
			payload, err := json.Marshal(map[string]any{
				"iss": srv.URL, "aud": "client-1", "sub": "user-1", "email": canaryClaim,
				"exp": now.Add(time.Hour).Unix(), "iat": now.Unix(), "nonce": "the-nonce",
			})
			require.NoError(t, err)
			signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithHeader("kid", "k1"))
			require.NoError(t, err)
			jws, err := signer.Sign(payload)
			require.NoError(t, err)
			token, err := jws.CompactSerialize()
			require.NoError(t, err)
			_, _ = fmt.Fprintf(w, `{"access_token":%q,"token_type":"bearer","id_token":%q}`, canaryToken, token)
		}
	}))
	t.Cleanup(srv.Close)
	return []byte(`{
		"slug": "google", "protocol": "oidc", "display_name": "Google",
		"claim_mapping": {"email": "email"},
		"oidc": {
			"issuer": "` + srv.URL + `", "client_id": "client-1", "client_secret": "${{ GOOGLE_SECRET }}",
			"scopes": ["openid"], "id_token_mapping": true, "pkce_enabled": false,
			"authorization_endpoint": "` + srv.URL + `/authorize", "token_endpoint": "` + srv.URL + `/token",
			"userinfo_endpoint": "` + srv.URL + `/userinfo", "jwks_uri": "` + srv.URL + `/keys"
		}
	}`)
}

func TestFlowSSOCallback_Process_EmitsOneEventPerPhase(t *testing.T) {
	t.Parallel()
	type want struct {
		phase, status, reason, side string
	}
	tests := []struct {
		name       string
		in         service.FlowSSOCallbackInput
		consumeErr error
		// revision is how the pinned revision is read; nil means it is not.
		revision *revisionRead
		want     []want
	}{
		{
			name:     "a completed callback reports the callback and the exchange",
			in:       service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Code: "the-code"},
			revision: &revisionRead{secret: &domain.Variable{Name: "GOOGLE_SECRET", Value: canarySecret, IsSecret: true}},
			want:     []want{{"callback_received", "ok", "", ""}, {"exchange_finished", "ok", "", ""}},
		},
		{
			name: "access_denied is the provider's",
			in:   service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Error: "access_denied"},
			want: []want{{"callback_received", "failed", "provider_denied", "provider"}},
		},
		{
			name: "any other provider error is the provider's",
			in:   service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Error: "server_error"},
			want: []want{{"callback_received", "failed", "provider_error", "provider"}},
		},
		{
			name: "a callback with neither code nor error is the journey's",
			in:   service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState},
			want: []want{{"callback_received", "failed", "no_code", "journey"}},
		},
		{
			name: "another connection's path is the journey's",
			in:   service.FlowSSOCallbackInput{ConnectionSlug: "other", State: ssoCallbackState, Code: "the-code"},
			want: []want{{"callback_received", "failed", "state_mismatch", "journey"}},
		},
		{
			name:       "an unknown state is the journey's",
			in:         service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Code: "the-code"},
			consumeErr: domain.ErrSSOStateInvalid(),
			want:       []want{{"callback_received", "failed", "state_invalid", "journey"}},
		},
		{
			name: "a state without a project is the journey's",
			in:   service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: "no-separator", Code: "the-code"},
			want: []want{{"callback_received", "failed", "state_invalid", "journey"}},
		},
		{
			name:     "a refused code exchange is the provider's",
			in:       service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Code: "the-code"},
			revision: &revisionRead{failToken: true, secret: &domain.Variable{Name: "GOOGLE_SECRET", Value: canarySecret, IsSecret: true}},
			want:     []want{{"callback_received", "ok", "", ""}, {"exchange_finished", "failed", "exchange_failed", "provider"}},
		},
		{
			name:     "a secret that is not a secret variable is the journey's",
			in:       service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Code: "the-code"},
			revision: &revisionRead{secret: &domain.Variable{Name: "GOOGLE_SECRET", Value: "plain"}},
			want:     []want{{"callback_received", "ok", "", ""}, {"exchange_finished", "failed", "secret_unavailable", "journey"}},
		},
		{
			name:     "a connection revision that cannot be read is the journey's",
			in:       service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Code: "the-code"},
			revision: &revisionRead{err: errors.New("gone")},
			want:     []want{{"callback_received", "ok", "", ""}, {"exchange_finished", "failed", "connection_invalid", "journey"}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			var logs bytes.Buffer
			ctx := zlog.WithLoggingContext(t.Context(), slog.New(slog.NewJSONHandler(&logs, nil)))
			svc, attempts := newCallbackWithRevision(t, tt.revision, tt.consumeErr)

			_, _ = svc.Process(ctx, tt.in)

			events := ssoEventRecords(t, logs.Bytes())
			require.Len(t, events, len(tt.want))
			for i, w := range tt.want {
				assert.Equal(t, w.phase, events[i]["phase"])
				assert.Equal(t, w.status, events[i]["status"])
				if w.reason != "" {
					assert.Equal(t, w.reason, events[i]["reason"])
					assert.Equal(t, w.side, events[i]["side"])
				} else {
					assert.NotContains(t, events[i], "reason")
				}
				if attempts.consumeErr == nil && tt.in.State == ssoCallbackState {
					assert.Equal(t, "att_1", events[i]["flow_id"])
					assert.Equal(t, ssoCallbackSlug, events[i]["slug"])
				}
			}
		})
	}
}

// Whatever a phase meets, none of it reaches an event: not the code, the
// state, the secret, the tokens, a claim value, nor the provider's own words
// or the query string they arrive in.
func TestFlowSSOCallback_Process_EventsCarryNoSecrets(t *testing.T) {
	t.Parallel()
	secret := &domain.Variable{Name: "GOOGLE_SECRET", Value: canarySecret, IsSecret: true}
	tests := []struct {
		name       string
		in         service.FlowSSOCallbackInput
		consumeErr error
		revision   *revisionRead
		wantClaims bool
	}{
		{
			name:       "a completed exchange",
			in:         service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Code: canaryCode, BindingNonce: canaryState},
			revision:   &revisionRead{secret: secret},
			wantClaims: true,
		},
		{
			name:     "a refused exchange whose answer echoes the code and the secret",
			in:       service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Code: canaryCode},
			revision: &revisionRead{failToken: true, secret: secret},
		},
		{
			name: "a provider error with its description and uri",
			in: service.FlowSSOCallbackInput{
				ConnectionSlug: ssoCallbackSlug, State: ssoCallbackState, Error: "access_denied",
				ErrorDescription: canaryText + canaryCode, ErrorURI: "https://provider.example.test/?code=" + canaryCode,
			},
		},
		{
			name:       "an unknown state",
			in:         service.FlowSSOCallbackInput{ConnectionSlug: ssoCallbackSlug, State: canaryState, Code: canaryCode},
			consumeErr: domain.ErrSSOStateInvalid(),
		},
		{
			name: "a callback on another connection's path",
			in:   service.FlowSSOCallbackInput{ConnectionSlug: "other", State: ssoCallbackState, Code: canaryCode, Issuer: "https://evil.example.test/?q=" + canaryText},
		},
		{
			name:       "a callback path that is not a slug",
			in:         service.FlowSSOCallbackInput{ConnectionSlug: canaryText + "?code=" + canaryCode, State: canaryState, Code: canaryCode},
			consumeErr: domain.ErrSSOStateInvalid(),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			var logs bytes.Buffer
			ctx := zlog.WithLoggingContext(t.Context(), slog.New(slog.NewJSONHandler(&logs, nil)))
			svc, _ := newCallbackWithRevision(t, tt.revision, tt.consumeErr)

			_, _ = svc.Process(ctx, tt.in)

			events := ssoEventRecords(t, logs.Bytes())
			require.NotEmpty(t, events)
			out, err := json.Marshal(events)
			require.NoError(t, err)
			for _, canary := range []string{canaryCode, canaryState, canarySecret, canaryToken, canaryClaim, canaryText, "?"} {
				assert.NotContains(t, string(out), canary)
			}
			if tt.wantClaims {
				assert.Equal(t, []any{"email"}, events[len(events)-1]["claims"])
			}
		})
	}
}

// revisionRead describes the pinned connection revision a callback reads: the
// canary provider behind it, the secret variable it resolves, or the error the
// read fails with.
type revisionRead struct {
	failToken bool
	secret    *domain.Variable
	err       error
}

func newCallbackWithRevision(t *testing.T, rev *revisionRead, consumeErr error) (*service.FlowSSOCallback, *fakeAuthAttempts) {
	t.Helper()
	ctrl := gomock.NewController(t)
	connections := servicemocks.NewMockIDPConnectionService(ctrl)
	variables := servicemocks.NewMockVariableService(ctrl)
	if rev != nil && rev.err != nil {
		connections.EXPECT().GetRevision(gomock.Any(), "proj-1", "idprev_1").Return(nil, rev.err)
	} else if rev != nil {
		connections.EXPECT().GetRevision(gomock.Any(), "proj-1", "idprev_1").
			Return(&domain.IDPConnection{Slug: ssoCallbackSlug, RevisionID: "idprev_1", Document: ssoCanaryProvider(t, rev.failToken)}, nil)
		variables.EXPECT().GetDecryptedVariables(gomock.Any(), gomock.Any(), gomock.Any(), "GOOGLE_SECRET").Return([]*domain.Variable{rev.secret}, nil)
	}
	attempts := &fakeAuthAttempts{
		consumeCheck: &domain.SSOCallbackCheck{AuthAttemptID: "att_1", Pending: ssoCallbackPending()},
		consumeErr:   consumeErr,
	}
	return service.NewFlowSSOCallback(connections, attempts, servicemocks.NewMockKeyService(ctrl), variables, &http.Client{}), attempts
}
