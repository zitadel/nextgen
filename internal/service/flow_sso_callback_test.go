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
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
)

const ssoCallbackState = "proj-1.random-part"

func ssoCallbackPending() *domain.SSOStatePayload {
	return &domain.SSOStatePayload{
		ProviderSlug:         "google",
		ConnectionRevisionID: "idprev_1",
		RedirectURI:          "https://auth.example.com/__nextgen/idp/callback",
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
		name         string
		in           service.FlowSSOCallbackInput
		consumeErr   error
		setResultErr error
		connections  func(m *servicemocks.MockIDPConnectionService)
		variables    func(m *servicemocks.MockVariableService)
		wantErr      error
		// wantResult is what must have been stored on the record; nil means
		// nothing was stored.
		wantResult *domain.SSOCallbackResult
	}{
		{
			name:    "a state without a project part is invalid and never looked up",
			in:      service.FlowSSOCallbackInput{State: "no-separator", Code: "the-code"},
			wantErr: domain.ErrSSOStateInvalid(),
		},
		{
			name:       "a consume failure passes through",
			in:         service.FlowSSOCallbackInput{State: ssoCallbackState, Code: "the-code"},
			consumeErr: domain.ErrSSOStateInvalid(),
			wantErr:    domain.ErrSSOStateInvalid(),
		},
		{
			name:       "access_denied stores the cancelled key",
			in:         service.FlowSSOCallbackInput{State: ssoCallbackState, Error: "access_denied", ErrorDescription: "the provider's words"},
			wantResult: &domain.SSOCallbackResult{ProviderSlug: "google", ErrorKey: domain.FlowStepErrorSSOCancelled},
		},
		{
			name:       "every other provider code stores the failed key",
			in:         service.FlowSSOCallbackInput{State: ssoCallbackState, Error: "temporarily_unavailable"},
			wantResult: &domain.SSOCallbackResult{ProviderSlug: "google", ErrorKey: domain.FlowStepErrorSSOFailed},
		},
		{
			name:       "neither code nor error stores the failed key",
			in:         service.FlowSSOCallbackInput{State: ssoCallbackState},
			wantResult: &domain.SSOCallbackResult{ProviderSlug: "google", ErrorKey: domain.FlowStepErrorSSOFailed},
		},
		{
			name: "a vanished revision stores the failed key",
			in:   service.FlowSSOCallbackInput{State: ssoCallbackState, Code: "the-code"},
			connections: func(m *servicemocks.MockIDPConnectionService) {
				m.EXPECT().GetRevision(gomock.Any(), "proj-1", "idprev_1").Return(nil, domain.ErrIDPConnectionNotFound())
			},
			wantResult: &domain.SSOCallbackResult{ProviderSlug: "google", ErrorKey: domain.FlowStepErrorSSOFailed},
		},
		{
			name: "a missing client_secret variable stores the failed key without a token request",
			in:   service.FlowSSOCallbackInput{State: ssoCallbackState, Code: "the-code"},
			connections: func(m *servicemocks.MockIDPConnectionService) {
				m.EXPECT().GetRevision(gomock.Any(), "proj-1", "idprev_1").
					Return(&domain.IDPConnection{Slug: "google", RevisionID: "idprev_1", Document: revisionDoc}, nil)
			},
			variables: func(m *servicemocks.MockVariableService) {
				m.EXPECT().GetDecryptedVariables(gomock.Any(), domain.VariableOwner{ProjectID: "proj-1"}, "GOOGLE_SECRET").Return(nil, nil)
			},
			wantResult: &domain.SSOCallbackResult{ProviderSlug: "google", ErrorKey: domain.FlowStepErrorSSOFailed},
		},
		{
			name: "a client_secret variable not marked secret stores the failed key without a token request",
			in:   service.FlowSSOCallbackInput{State: ssoCallbackState, Code: "the-code"},
			connections: func(m *servicemocks.MockIDPConnectionService) {
				m.EXPECT().GetRevision(gomock.Any(), "proj-1", "idprev_1").
					Return(&domain.IDPConnection{Slug: "google", RevisionID: "idprev_1", Document: revisionDoc}, nil)
			},
			variables: func(m *servicemocks.MockVariableService) {
				m.EXPECT().GetDecryptedVariables(gomock.Any(), domain.VariableOwner{ProjectID: "proj-1"}, "GOOGLE_SECRET").
					Return([]*domain.Variable{{Name: "GOOGLE_SECRET", Value: "plain", IsSecret: false}}, nil)
			},
			wantResult: &domain.SSOCallbackResult{ProviderSlug: "google", ErrorKey: domain.FlowStepErrorSSOFailed},
		},
		{
			name: "a literal client_secret stores the failed key without a token request",
			in:   service.FlowSSOCallbackInput{State: ssoCallbackState, Code: "the-code"},
			connections: func(m *servicemocks.MockIDPConnectionService) {
				doc := bytes.Replace(revisionDoc, []byte(`"${{ GOOGLE_SECRET }}"`), []byte(`"pasted-secret"`), 1)
				m.EXPECT().GetRevision(gomock.Any(), "proj-1", "idprev_1").
					Return(&domain.IDPConnection{Slug: "google", RevisionID: "idprev_1", Document: doc}, nil)
			},
			wantResult: &domain.SSOCallbackResult{ProviderSlug: "google", ErrorKey: domain.FlowStepErrorSSOFailed},
		},
		{
			name: "an internal failure is returned and stores nothing",
			in:   service.FlowSSOCallbackInput{State: ssoCallbackState, Code: "the-code"},
			connections: func(m *servicemocks.MockIDPConnectionService) {
				m.EXPECT().GetRevision(gomock.Any(), "proj-1", "idprev_1").Return(nil, domain.ErrInternal(errors.New("db down")))
			},
			wantErr: domain.ErrInternal(nil),
		},
		{
			name:         "a refused result write passes through",
			in:           service.FlowSSOCallbackInput{State: ssoCallbackState, Error: "access_denied"},
			setResultErr: domain.ErrSSOStateInvalid(),
			wantErr:      domain.ErrSSOStateInvalid(),
			wantResult:   &domain.SSOCallbackResult{ProviderSlug: "google", ErrorKey: domain.FlowStepErrorSSOCancelled},
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
				consumeCheck: &domain.SSOCallbackCheck{Pending: ssoCallbackPending()},
				consumeErr:   tt.consumeErr,
				setResultErr: tt.setResultErr,
			}
			svc := service.NewFlowSSOCallback(connections, attempts, servicemocks.NewMockKeyService(ctrl), variables, &http.Client{Transport: tripwireTransport{t}})

			out, err := svc.Process(t.Context(), tt.in)

			assert.Equal(t, tt.wantResult, attempts.setResult)
			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, "https://app.example.com/login?flow=flow-1", out.ReturnTarget)
			assert.Equal(t, ssoCallbackState, attempts.setResultState)
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

			_, err := svc.Process(ctx, service.FlowSSOCallbackInput{State: ssoCallbackState, Code: "the-code"})
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

			_, _ = svc.Process(ctx, service.FlowSSOCallbackInput{State: ssoCallbackState, Error: "access_denied"})

			slot, ok := audit.ActorSlotFromContext(ctx)
			require.True(t, ok)
			assert.Equal(t, tt.wantProject, slot.ProjectID)
		})
	}
}

// ssoCallbackProvider is a fake provider for the full exchange: /keys serves
// the signing key, /token checks the secret and answers a signed id_token.
func ssoCallbackProvider(t *testing.T) (doc []byte) {
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
	}`)
}

func TestFlowSSOCallback_Process_StoresTheIdentity(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	connections := servicemocks.NewMockIDPConnectionService(ctrl)
	connections.EXPECT().GetRevision(gomock.Any(), "proj-1", "idprev_1").
		Return(&domain.IDPConnection{Slug: "google", RevisionID: "idprev_1", Document: ssoCallbackProvider(t)}, nil)
	variables := servicemocks.NewMockVariableService(ctrl)
	variables.EXPECT().GetDecryptedVariables(gomock.Any(), domain.VariableOwner{ProjectID: "proj-1"}, "GOOGLE_SECRET").
		Return([]*domain.Variable{{Name: "GOOGLE_SECRET", Value: "secret-1", IsSecret: true}}, nil)
	attempts := &fakeAuthAttempts{consumeCheck: &domain.SSOCallbackCheck{Pending: ssoCallbackPending()}}
	svc := service.NewFlowSSOCallback(connections, attempts, servicemocks.NewMockKeyService(ctrl), variables, &http.Client{})

	out, err := svc.Process(t.Context(), service.FlowSSOCallbackInput{State: ssoCallbackState, Code: "the-code", BindingNonce: "bind-1"})
	require.NoError(t, err)

	assert.Equal(t, ssoCallbackState, attempts.consumeState)
	assert.Equal(t, "bind-1", attempts.consumeNonce)
	assert.Equal(t, "https://app.example.com/login?flow=flow-1", out.ReturnTarget)
	require.NotNil(t, attempts.setResult)
	assert.Equal(t, "user-1", attempts.setResult.Subject)
	assert.Equal(t, "idprev_1", attempts.setResult.ConnectionRevisionID)
	assert.Equal(t, "google", attempts.setResult.ProviderSlug)
	assert.False(t, attempts.setResult.IsError())
}