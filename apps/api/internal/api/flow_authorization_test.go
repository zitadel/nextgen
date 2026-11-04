package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/api"
	gen "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

const bindingCookie = "__Host-_zauthz_req1"

// fakeAuthRequests is the authorization server the handler opens requests
// with: it records what the handler gave it.
type fakeAuthRequests struct {
	req       *domain.FlowAuthRequest
	err       error
	gotHandle string
	gotBound  string
}

func (f *fakeAuthRequests) ResolveAuthRequest(_ context.Context, _ string, handle string, cookie func(string) (string, bool)) (*domain.FlowAuthRequest, error) {
	f.gotHandle = handle
	f.gotBound, _ = cookie(bindingCookie)
	return f.req, f.err
}

func agentAuthRequest() *domain.FlowAuthRequest {
	return &domain.FlowAuthRequest{
		ID:            "req1",
		BindingCookie: bindingCookie,
		Client:        domain.FlowClient{ID: "https://agent.example/client.json", Name: "Agent", RedirectHost: "127.0.0.1:5000"},
		API:           domain.FlowAPI{Identifier: "https://zitadel.example.com/mcp", Name: "Zitadel MCP server"},
		Scope:         []string{"openid"},
		Record:        json.RawMessage(`{}`),
	}
}

// createFlow posts a flow start with the browser's cookies.
func createFlow(t *testing.T, ts *testServer, body map[string]any, cookies ...*http.Cookie) (*http.Response, []byte) {
	t.Helper()
	b, err := json.Marshal(body)
	require.NoError(t, err)
	req, err := http.NewRequest(http.MethodPost, ts.srv.URL+"/flow", bytes.NewReader(b))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	for _, c := range cookies {
		req.AddCookie(c)
	}
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return resp, data
}

func loginDef() *domain.FlowDefinition {
	return &domain.FlowDefinition{ProjectID: "proj_1", ID: "def_1", Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "identify"}}
}

func errorCode(t *testing.T, body []byte) string {
	t.Helper()
	var details struct {
		Code string `json:"code"`
	}
	require.NoError(t, json.Unmarshal(body, &details), string(body))
	return details.Code
}

// A flow that answers a request ends in a redirect to the client, so it takes
// no redirect_uri of its own (ADR 081 §9).
func TestCreateFlow_RefusesAnAuthRequestWithARedirectURI(t *testing.T) {
	ts := newTestServer(t, api.WithRequestCookies)
	ts.handler.WithAuthRequests(&fakeAuthRequests{req: agentAuthRequest()})
	ts.fake.def = loginDef()

	resp, body := createFlow(t, ts, map[string]any{
		"project_id": "proj_1", "purpose": "login",
		"auth_request_id": "handle", "redirect_uri": "https://elsewhere.example/",
	})

	assert.Equal(t, http.StatusBadRequest, resp.StatusCode, string(body))
	assert.Equal(t, "req.invalid", errorCode(t, body))
}

// Without an authorization server, a page's auth_request opens nothing.
func TestCreateFlow_AnAuthRequestNeedsTheAuthorizationServer(t *testing.T) {
	ts := newTestServer(t, api.WithRequestCookies)
	ts.fake.def = loginDef()

	resp, body := createFlow(t, ts, map[string]any{"project_id": "proj_1", "purpose": "login", "auth_request_id": "handle"})

	assert.Equal(t, http.StatusBadRequest, resp.StatusCode, string(body))
	assert.Equal(t, "flow.auth_request_invalid", errorCode(t, body))
}

// The handler opens the request with the page's handle and the browser's
// binding cookie, starts the flow for it with the user the browser's live
// session names, and names the client on the response (ADR 081 §8).
func TestCreateFlow_StartsTheFlowForTheRequestInItsBrowser(t *testing.T) {
	ts := newTestServer(t, api.WithRequestCookies)
	authRequests := &fakeAuthRequests{req: agentAuthRequest()}
	ts.handler.WithAuthRequests(authRequests)
	ts.fake.def = loginDef()
	sessionID := "sess_bob"
	ts.tokens.EXPECT().IntrospectToken(gomock.Any(), "bobs-session").Return(&domain.Token{
		ProjectID: "proj_1", UserID: "user_bob", Type: domain.TokenTypeSessionToken, SessionID: &sessionID,
	}, nil)
	ts.fake.startResult = domain.FlowStepResult{
		State: &domain.FlowState{ID: "flow_1", ProjectID: "proj_1", SessionID: "sess_1", IssuedAt: time.Now(), AuthRequest: agentAuthRequest(), AwaitingConsent: true},
		Step: &domain.FlowStep{
			Name: domain.FlowStepNameConsent,
			Consent: &domain.FlowStepConsent{
				API:    domain.FlowAPI{Identifier: "https://zitadel.example.com/mcp", Name: "Zitadel MCP server"},
				Scopes: []domain.FlowConsentScope{{Name: "openid", TextKey: "scope.openid"}},
			},
		},
	}

	resp, body := createFlow(t, ts, map[string]any{"project_id": "proj_1", "purpose": "login", "auth_request_id": "handle"},
		&http.Cookie{Name: bindingCookie, Value: "nonce"},
		&http.Cookie{Name: "__Host-zitadel_session", Value: "bobs-session"},
	)

	require.Equal(t, http.StatusCreated, resp.StatusCode, string(body))
	assert.Equal(t, "handle", authRequests.gotHandle)
	assert.Equal(t, "nonce", authRequests.gotBound)
	assert.Equal(t, agentAuthRequest(), ts.fake.gotStartReq.AuthRequest)
	assert.Equal(t, "user_bob", ts.fake.gotStartReq.SessionUserID)
	var fr gen.FlowResponse
	require.NoError(t, json.Unmarshal(body, &fr))
	client, ok := fr.Client.Get()
	require.True(t, ok, "the response names the client")
	assert.Equal(t, "Agent", client.Name)
	assert.Equal(t, gen.FlowClientPartyThirdParty, client.Party)
	assert.Equal(t, "127.0.0.1:5000", client.RedirectHost)
	consent, ok := fr.Step.Consent.Get()
	require.True(t, ok, "the consent step carries what it asks")
	assert.Equal(t, "Zitadel MCP server", consent.API.Name)
	assert.Equal(t, []gen.FlowConsentScopesItem{{Name: "openid", TextKey: "scope.openid"}}, consent.Scopes)
	assert.False(t, strings.Contains(strings.Join(resp.Header.Values("Set-Cookie"), "\n"), bindingCookie+"=;"), "the binding lasts until the flow ends")
}

// A session that is not the project's, or no longer live, signs no one in.
func TestCreateFlow_OnlyALiveSessionOfTheProjectSignsTheUserIn(t *testing.T) {
	ts := newTestServer(t, api.WithRequestCookies)
	ts.handler.WithAuthRequests(&fakeAuthRequests{req: agentAuthRequest()})
	ts.fake.def = loginDef()
	ts.fake.startResult = domain.FlowStepResult{
		State: &domain.FlowState{ID: "flow_1", ProjectID: "proj_1", IssuedAt: time.Now(), AuthRequest: agentAuthRequest()},
		Step:  &domain.FlowStep{Name: "identify"},
	}
	sessionID := "sess_other"
	ts.tokens.EXPECT().IntrospectToken(gomock.Any(), "other-project").Return(&domain.Token{
		ProjectID: "proj_other", UserID: "user_bob", Type: domain.TokenTypeSessionToken, SessionID: &sessionID,
	}, nil)
	ts.tokens.EXPECT().IntrospectToken(gomock.Any(), "revoked").Return(nil, domain.ErrTokenRevoked())

	for _, cookie := range []string{"other-project", "revoked"} {
		resp, body := createFlow(t, ts, map[string]any{"project_id": "proj_1", "purpose": "login", "auth_request_id": "handle"},
			&http.Cookie{Name: "__Host-zitadel_session", Value: cookie})
		require.Equal(t, http.StatusCreated, resp.StatusCode, string(body))
		assert.Empty(t, ts.fake.gotStartReq.SessionUserID, cookie)
	}
}

// A flow the live session answers at once ends with its start: the flow
// cookie and the request's binding cookie go, and the browser goes back to
// the client.
func TestCreateFlow_AnsweredAtOnceEndsTheFlowAndItsBinding(t *testing.T) {
	ts := newTestServer(t, api.WithRequestCookies)
	ts.handler.WithAuthRequests(&fakeAuthRequests{req: agentAuthRequest()})
	ts.fake.def = loginDef()
	redirect := domain.FlowStepCompleteRedirect
	target := "http://127.0.0.1:5000/callback?code=c1&iss=https%3A%2F%2Fzitadel.example.com"
	ts.fake.startResult = domain.FlowStepResult{
		State: &domain.FlowState{ID: "flow_1", ProjectID: "proj_1", IssuedAt: time.Now(), AuthRequest: agentAuthRequest(), RedirectURI: &target, SessionUser: true},
		Step:  &domain.FlowStep{Name: "done", Complete: &redirect, RedirectURL: &target},
	}

	resp, body := createFlow(t, ts, map[string]any{"project_id": "proj_1", "purpose": "login", "auth_request_id": "handle"})

	require.Equal(t, http.StatusCreated, resp.StatusCode, string(body))
	var fr gen.FlowResponse
	require.NoError(t, json.Unmarshal(body, &fr))
	uri, ok := fr.RedirectURI.Get()
	require.True(t, ok)
	assert.Equal(t, target, uri.String())
	assert.False(t, fr.HandoffToken.IsSet(), "the browser keeps the session it has")
	cookies := map[string]*http.Cookie{}
	for _, c := range resp.Cookies() {
		cookies[c.Name] = c
	}
	require.Contains(t, cookies, "_zflow")
	assert.Negative(t, cookies["_zflow"].MaxAge, "the flow ended")
	require.Contains(t, cookies, bindingCookie)
	assert.Negative(t, cookies[bindingCookie].MaxAge, "the request is answered")
	assert.True(t, cookies[bindingCookie].Secure, "a __Host- cookie is replaced only by a Secure one")
}
