package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/oidc/v3/pkg/op"
	gen "github.com/zitadel/zitadel/v5/api/generated"
	"github.com/zitadel/zitadel/v5/internal/api"
	"github.com/zitadel/zitadel/v5/internal/crypto"
	"github.com/zitadel/zitadel/v5/internal/domain"
	"github.com/zitadel/zitadel/v5/internal/service"
	"github.com/zitadel/zitadel/v5/internal/service/mocks"
	"go.uber.org/mock/gomock"
)

// fakeFlowSvc lets handler tests exercise cookie + HTTP plumbing without
// booting a real state machine.
type fakeFlowSvc struct {
	def        *domain.FlowDefinition
	resolveErr error

	startResult  domain.FlowStepResult
	startErr     error
	submitResult domain.FlowStepResult
	submitErr    error
	getResult    domain.FlowStepResult
	getErr       error

	gotStartReq  service.StartFlowRequest
	gotSubmitReq service.SubmitFlowRequest
	gotGetReq    service.GetFlowStepRequest
}

func (f *fakeFlowSvc) Resolve(_ context.Context, _ service.ResolveFlowRequest) (*domain.FlowDefinition, error) {
	return f.def, f.resolveErr
}

func (f *fakeFlowSvc) Start(_ context.Context, req service.StartFlowRequest) (domain.FlowStepResult, error) {
	f.gotStartReq = req
	return f.startResult, f.startErr
}

func (f *fakeFlowSvc) Submit(_ context.Context, req service.SubmitFlowRequest) (domain.FlowStepResult, error) {
	f.gotSubmitReq = req
	return f.submitResult, f.submitErr
}

func (f *fakeFlowSvc) GetStep(_ context.Context, req service.GetFlowStepRequest) (domain.FlowStepResult, error) {
	f.gotGetReq = req
	return f.getResult, f.getErr
}

var _ service.FlowService = (*fakeFlowSvc)(nil)

// stubAuthAttempt only exists to satisfy the handler dependency; flow
// handlers never call it directly.
type stubAuthAttempt struct{}

func (stubAuthAttempt) Create(context.Context, service.CreateAuthAttemptInput) (*domain.AuthAttempt, error) {
	return nil, errors.New("stub auth attempt")
}
func (stubAuthAttempt) GetByID(context.Context, string, string) (*domain.AuthAttempt, error) {
	return nil, errors.New("stub auth attempt")
}
func (stubAuthAttempt) IssueChallenge(context.Context, service.IssueChallengeInput) (*domain.AuthAttempt, error) {
	return nil, errors.New("stub auth attempt")
}
func (stubAuthAttempt) IssueSSOState(context.Context, service.IssueSSOStateInput) (*domain.SSOState, error) {
	return nil, errors.New("stub auth attempt")
}
func (stubAuthAttempt) ConsumeSSOState(context.Context, string, string, string) (*domain.SSOCallbackCheck, error) {
	return nil, errors.New("stub auth attempt")
}
func (stubAuthAttempt) SetSSOCallbackResult(context.Context, string, *domain.SSOCallbackCheck, *domain.SSOCallbackResult, domain.EventType) error {
	return errors.New("stub auth attempt")
}
func (stubAuthAttempt) VerifyProof(context.Context, service.VerifyProofInput) (*domain.AuthAttempt, error) {
	return nil, errors.New("stub auth attempt")
}
func (stubAuthAttempt) Handoff(context.Context, service.HandoffInput) (*domain.AuthAttempt, error) {
	return nil, errors.New("stub auth attempt")
}

func (stubAuthAttempt) BeginPasskeyEnrollment(context.Context, service.BeginPasskeyEnrollmentInput) (*service.BeginPasskeyEnrollmentOutput, error) {
	return nil, errors.New("stub auth attempt")
}

func (stubAuthAttempt) FinishPasskeyEnrollment(context.Context, service.FinishPasskeyEnrollmentInput) (*service.FinishPasskeyEnrollmentOutput, error) {
	return nil, errors.New("stub auth attempt")
}

var _ service.AuthAttemptService = stubAuthAttempt{}

// fixedKey is a deterministic crypter key for tests.
var fixedKey = [32]byte{
	0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
	0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
	0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
	0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
}

type testServer struct {
	srv      *httptest.Server
	crypter  crypto.Crypter
	fake     *fakeFlowSvc
	projects *mocks.MockProjectService
}

// newTestServer serves the handler bare. Secure on a cookie follows the
// effective request host, which only WithRequestHostMiddleware injects, so
// a test that asserts the http loopback shape passes it as middleware.
func newTestServer(t *testing.T, middleware ...func(http.Handler) http.Handler) *testServer {
	t.Helper()
	return newTestServerSealing(t, nil, middleware...)
}

// newTestServerSealing lets a test make sealing a new cookie fail with
// sealErr while opening the presented one still works.
func newTestServerSealing(t *testing.T, sealErr error, middleware ...func(http.Handler) http.Handler) *testServer {
	t.Helper()

	crypter := op.NewAES256GCMCrypto(fixedKey, "")

	mock := gomock.NewController(t)
	tokenService := mocks.NewMockTokenService(mock)
	keyService := mocks.NewMockKeyService(mock)
	keyService.EXPECT().GetCrypter(gomock.Any(), gomock.Any(), gomock.Any()).Return(crypter, nil).AnyTimes()
	if sealErr != nil {
		keyService.EXPECT().GetProjectCrypter(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, sealErr).AnyTimes()
	} else {
		keyService.EXPECT().GetProjectCrypter(gomock.Any(), gomock.Any(), gomock.Any()).Return(crypter, nil).AnyTimes()
	}

	fake := &fakeFlowSvc{}
	// The release service is a mock rather than nil so a test that reaches a
	// release endpoint fails on an unexpected call instead of panicking on a
	// nil interface.
	releaseService := mocks.NewMockReleaseService(mock)
	// The project service is read only when a submit carries an Origin, so
	// a test that sends one sets its expectation.
	projects := mocks.NewMockProjectService(mock)
	handler := api.NewHandler(fake, stubAuthAttempt{}, nil, projects, nil, nil, nil, nil, nil, nil, releaseService, nil, nil, nil, tokenService, keyService, nil, nil, nil, nil, "")
	oas, err := gen.NewServer(
		handler,
		api.NewSecurityHandler(tokenService),
		gen.WithErrorHandler(api.OgenErrorHandler),
	)
	require.NoError(t, err)
	var h http.Handler = oas
	for _, mw := range middleware {
		h = mw(h)
	}
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return &testServer{srv: srv, crypter: crypter, fake: fake, projects: projects}
}

// sealCookie matches what the handler emits, so tests can skip CreateFlow.
func (ts *testServer) sealCookie(t *testing.T, state *domain.FlowState) string {
	t.Helper()
	payload, err := json.Marshal(state)
	require.NoError(t, err)
	value, err := ts.crypter.Encrypt(string(payload))
	require.NoError(t, err)
	return value
}

func doRequest(t *testing.T, method, url string, body any, cookieValue string) (*http.Response, []byte) {
	t.Helper()
	return doRequestWithOrigin(t, method, url, body, cookieValue, "")
}

func doRequestWithOrigin(t *testing.T, method, url string, body any, cookieValue, origin string) (*http.Response, []byte) {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		require.NoError(t, err)
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, url, rdr)
	require.NoError(t, err)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if cookieValue != "" {
		req.AddCookie(&http.Cookie{Name: "_zflow", Value: cookieValue})
	}
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return resp, data
}

func TestCreateFlow_ReturnsCookieAndFlowID(t *testing.T) {
	ts := newTestServer(t)
	ts.fake.def = &domain.FlowDefinition{ProjectID: "proj_1", ID: "def_1", Purposes: map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "identify"}}
	ts.fake.startResult = domain.FlowStepResult{
		State: &domain.FlowState{ID: "flow_1", ProjectID: "proj_1", SessionID: "sess_1", IssuedAt: time.Now()},
		Step:  &domain.FlowStep{Name: "identify"},
	}

	resp, body := doRequest(t, http.MethodPost, ts.srv.URL+"/flow", map[string]any{
		"project_id": "proj_1",
		"purpose":    "login",
	}, "")
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", resp.StatusCode, body)
	}
	if !strings.Contains(resp.Header.Get("Set-Cookie"), "_zflow=") {
		t.Errorf("expected Set-Cookie header, got %q", resp.Header.Get("Set-Cookie"))
	}
	var fr gen.FlowResponse
	if err := json.Unmarshal(body, &fr); err != nil {
		t.Fatalf("unmarshal: %v (body=%s)", err, body)
	}
	if fr.ID != "flow_1" {
		t.Errorf("id = %q, want flow_1", fr.ID)
	}
	if b, ok := fr.Branding.Get(); !ok || b.Layout.Value != gen.BrandingLayoutCentered || b.LiquidTemplate.IsSet() {
		t.Errorf("expected branding with centered layout and no liquid_template, got %+v", fr.Branding)
	}
}

func TestSubmitFlowStep_PathIDMismatchReturns404(t *testing.T) {
	ts := newTestServer(t)
	state := &domain.FlowState{ID: "flow_real", IssuedAt: time.Now()}
	cookieVal := ts.sealCookie(t, state)

	resp, body := doRequest(t, http.MethodPost, ts.srv.URL+"/flow/flow_wrong/submit", map[string]any{
		"action": "submit",
	}, cookieVal)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, body = %s", resp.StatusCode, body)
	}
}

func TestSubmitFlowStep_TamperedCookieReturns401(t *testing.T) {
	ts := newTestServer(t)
	resp, _ := doRequest(t, http.MethodPost, ts.srv.URL+"/flow/flow_1/submit", map[string]any{
		"action": "submit",
	}, "garbage")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d", resp.StatusCode)
	}
}

func TestSubmitFlowStep_StaleCookieReturns401(t *testing.T) {
	ts := newTestServer(t)

	stale := time.Now().Add(-1 * time.Hour)
	state := &domain.FlowState{ID: "flow_1", IssuedAt: stale}
	cookieVal := ts.sealCookie(t, state)

	resp, _ := doRequest(t, http.MethodPost, ts.srv.URL+"/flow/flow_1/submit", map[string]any{
		"action": "submit",
	}, cookieVal)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 for stale cookie", resp.StatusCode)
	}
}

func TestSubmitFlowStep_HappyPath_RotatesCookie(t *testing.T) {
	ts := newTestServer(t)
	state := &domain.FlowState{ID: "flow_1", ProjectID: "proj_1", SessionID: "sess_1", IssuedAt: time.Now()}
	cookieVal := ts.sealCookie(t, state)

	advanced := &domain.FlowState{ID: "flow_1", ProjectID: "proj_1", SessionID: "sess_1", IssuedAt: time.Now()}
	ts.fake.submitResult = domain.FlowStepResult{State: advanced, Step: &domain.FlowStep{Name: "password"}}

	resp, body := doRequest(t, http.MethodPost, ts.srv.URL+"/flow/flow_1/submit", map[string]any{
		"action": "submit",
		"fields": map[string]any{"identifier": "alice@example.com"},
	}, cookieVal)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, body = %s", resp.StatusCode, body)
	}
	if got := resp.Header.Get("Set-Cookie"); !strings.Contains(got, "_zflow=") {
		t.Errorf("expected rotated Set-Cookie, got %q", got)
	}
	if got := ts.fake.gotSubmitReq.Fields["identifier"]; got != "alice@example.com" {
		t.Errorf("decoded identifier = %v, want alice@example.com", got)
	}
}

func TestSubmitFlowStep_TerminalClearsCookie(t *testing.T) {
	ts := newTestServer(t)
	state := &domain.FlowState{ID: "flow_1", IssuedAt: time.Now()}
	cookieVal := ts.sealCookie(t, state)

	complete := domain.FlowStepCompleteShow
	terminal := &domain.FlowState{ID: "flow_1", IssuedAt: time.Now()}
	ts.fake.submitResult = domain.FlowStepResult{State: terminal, Step: &domain.FlowStep{Name: "done", Complete: &complete}}

	resp, _ := doRequest(t, http.MethodPost, ts.srv.URL+"/flow/flow_1/submit", map[string]any{
		"action": "submit",
	}, cookieVal)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	got := resp.Header.Get("Set-Cookie")
	if !strings.Contains(got, "Max-Age=0") {
		t.Errorf("expected Max-Age=0 on terminal, got %q", got)
	}
}

func TestSubmitFlowStep_TerminalSurfacesHandoffToken(t *testing.T) {
	ts := newTestServer(t)
	state := &domain.FlowState{ID: "flow_1", IssuedAt: time.Now()}
	cookieVal := ts.sealCookie(t, state)

	complete := domain.FlowStepCompleteShow
	expiresAt := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)
	ts.fake.submitResult = domain.FlowStepResult{
		State:                 &domain.FlowState{ID: "flow_1", IssuedAt: time.Now()},
		Step:                  &domain.FlowStep{Name: "done", Complete: &complete},
		HandoffToken:          "ht_abc",
		HandoffTokenExpiresAt: expiresAt,
	}

	resp, body := doRequest(t, http.MethodPost, ts.srv.URL+"/flow/flow_1/submit", map[string]any{
		"action": "submit",
	}, cookieVal)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, body = %s", resp.StatusCode, body)
	}
	var fr gen.FlowResponse
	if err := json.Unmarshal(body, &fr); err != nil {
		t.Fatalf("unmarshal: %v (body=%s)", err, body)
	}
	if got, ok := fr.HandoffToken.Get(); !ok || got != "ht_abc" {
		t.Errorf("handoff_token = %v (set=%t), want ht_abc", got, ok)
	}
	if got, ok := fr.HandoffTokenExpiresAt.Get(); !ok || !got.Equal(expiresAt) {
		t.Errorf("handoff_token_expires_at = %v (set=%t), want %v", got, ok, expiresAt)
	}
}

func TestSubmitFlowStep_SSO_BindsTheBrowserAndResealsTheFlowCookie(t *testing.T) {
	tests := []struct {
		name       string
		origin     string
		middleware []func(http.Handler) http.Handler
		// returnTarget defaults to the login page on the bare origin.
		returnTarget string
		wantCookie   string
	}{
		{
			name:       "https origin gets the __Host- cookie",
			origin:     "https://login.example.com",
			wantCookie: "__Host-_zsso=nonce-1; Path=/; Max-Age=900; HttpOnly; Secure; SameSite=Lax",
		},
		{
			// A hash-routed page lives in its fragment; the callback must
			// bring the browser back to the route, not to a percent-encoded
			// path.
			name:         "return_target keeps its fragment",
			origin:       "https://login.example.com",
			returnTarget: "https://login.example.com/app#/sign-in?flow=flow_1",
			wantCookie:   "__Host-_zsso=nonce-1; Path=/; Max-Age=900; HttpOnly; Secure; SameSite=Lax",
		},
		{
			// Browsers send a bare origin; a trailing slash from another
			// client must not end up in redirect_uri.
			name:       "origin with a trailing slash is normalised",
			origin:     "https://login.example.com/",
			wantCookie: "__Host-_zsso=nonce-1; Path=/; Max-Age=900; HttpOnly; Secure; SameSite=Lax",
		},
		{
			// The test server listens on http loopback, which the middleware
			// turns into the effective host Secure follows.
			name:       "http loopback host drops the prefix and Secure",
			origin:     "http://localhost:3000",
			middleware: []func(http.Handler) http.Handler{api.WithRequestHostMiddleware},
			wantCookie: "_zsso=nonce-1; Path=/; Max-Age=900; HttpOnly; SameSite=Lax",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ts := newTestServer(t, tt.middleware...)
			state := &domain.FlowState{ID: "flow_1", ProjectID: "proj_1", SessionID: "sess_1", IssuedAt: time.Now()}
			ts.projects.EXPECT().Get(gomock.Any(), "proj_1").Return(&domain.Project{PreviewOrigins: []string{tt.origin}}, nil)
			ts.fake.submitResult = domain.FlowStepResult{
				State:           state,
				Step:            &domain.FlowStep{Name: "sso-redirect", RedirectURL: new("https://accounts.example.test/authorize?state=s")},
				SSOBindingNonce: "nonce-1",
			}

			bareOrigin := strings.TrimSuffix(tt.origin, "/")
			returnTarget := tt.returnTarget
			if returnTarget == "" {
				returnTarget = bareOrigin + "/login?flow=flow_1"
			}
			resp, body := doRequestWithOrigin(t, http.MethodPost, ts.srv.URL+"/flow/flow_1/submit", map[string]any{
				"action":          "sso",
				"sso_provider_id": "google",
				"return_target":   returnTarget,
			}, ts.sealCookie(t, state), tt.origin)
			require.Equal(t, http.StatusOK, resp.StatusCode, string(body))
			// Two lines, _zflow first: the generated client reads only the
			// first Set-Cookie line, so the order is part of the contract.
			setCookies := resp.Header.Values("Set-Cookie")
			require.Len(t, setCookies, 2, setCookies)
			zflow, err := http.ParseSetCookie(setCookies[0])
			require.NoError(t, err)
			require.Equal(t, "_zflow", zflow.Name)
			require.NotEmpty(t, zflow.Value)
			require.Equal(t, 600, zflow.MaxAge, "the redirect response re-seals the flow cookie")
			require.Equal(t, tt.wantCookie, setCookies[1])

			require.Equal(t, "google", *ts.fake.gotSubmitReq.SSOProviderID)
			require.Equal(t, &domain.FlowSSOReturn{
				RedirectURI:  bareOrigin + "/__nextgen/idp/callback",
				ReturnTarget: returnTarget,
			}, ts.fake.gotSubmitReq.SSOReturn)
			var out struct {
				Step struct {
					Name        string `json:"name"`
					RedirectURL string `json:"redirect_url"`
				} `json:"step"`
			}
			require.NoError(t, json.Unmarshal(body, &out))
			require.Equal(t, "sso-redirect", out.Step.Name)
			require.Equal(t, "https://accounts.example.test/authorize?state=s", out.Step.RedirectURL)
		})
	}
}

// A provider id on another action is not an sso submission: it passes
// through without the origin and return target checks, and the engine
// refuses it as an invalid action.
func TestSubmitFlowStep_SSO_ProviderIDAloneDoesNotSelectTheBranch(t *testing.T) {
	ts := newTestServer(t)
	state := &domain.FlowState{ID: "flow_1", ProjectID: "proj_1", SessionID: "sess_1", IssuedAt: time.Now()}
	ts.fake.submitErr = domain.ErrFlowInvalidAction()

	resp, body := doRequest(t, http.MethodPost, ts.srv.URL+"/flow/flow_1/submit", map[string]any{
		"action":          "submit",
		"sso_provider_id": "google",
	}, ts.sealCookie(t, state))
	require.Equal(t, http.StatusBadRequest, resp.StatusCode, string(body))
	require.Equal(t, "submit", ts.fake.gotSubmitReq.Action, "the submission reaches the engine")
	require.Equal(t, "google", *ts.fake.gotSubmitReq.SSOProviderID)
	require.Nil(t, ts.fake.gotSubmitReq.SSOReturn)
	require.Contains(t, string(body), "flow.invalid_action")
}

// A handed-off attempt cannot start another sign-in. Only a client that
// kept the flow cookie past the terminal response reaches this, so the
// browser never sees it; the status is the same conflict the attempt
// endpoints answer with.
func TestSubmitFlowStep_SSO_HandedOffAttemptIsAConflict(t *testing.T) {
	const origin = "https://login.example.com"
	ts := newTestServer(t)
	state := &domain.FlowState{ID: "flow_1", ProjectID: "proj_1", SessionID: "sess_1", IssuedAt: time.Now()}
	ts.fake.submitErr = domain.ErrAuthAttemptAlreadyHandedOff()
	ts.projects.EXPECT().Get(gomock.Any(), "proj_1").Return(&domain.Project{PreviewOrigins: []string{origin}}, nil)

	resp, body := doRequestWithOrigin(t, http.MethodPost, ts.srv.URL+"/flow/flow_1/submit", map[string]any{
		"action":          "sso",
		"sso_provider_id": "google",
		"return_target":   origin + "/login",
	}, ts.sealCookie(t, state), origin)
	require.Equal(t, http.StatusConflict, resp.StatusCode, string(body))
	require.Contains(t, string(body), "att.already_handed_off")
}

// The length limit is the generated validation's: the request is refused
// before the handler reads the project.
func TestSubmitFlowStep_SSO_RejectsAnOverlongReturnTarget(t *testing.T) {
	const origin = "https://login.example.com"
	ts := newTestServer(t)
	state := &domain.FlowState{ID: "flow_1", ProjectID: "proj_1", SessionID: "sess_1", IssuedAt: time.Now()}

	resp, body := doRequestWithOrigin(t, http.MethodPost, ts.srv.URL+"/flow/flow_1/submit", map[string]any{
		"action":          "sso",
		"sso_provider_id": "google",
		"return_target":   origin + "/login?pad=" + strings.Repeat("x", 2048),
	}, ts.sealCookie(t, state), origin)
	require.Equal(t, http.StatusBadRequest, resp.StatusCode, string(body))
	require.Contains(t, string(body), "return_target")
	require.Empty(t, ts.fake.gotSubmitReq.Action, "no sign-in is started")
}

func TestSubmitFlowStep_SSO_RejectsAnUnboundReturn(t *testing.T) {
	const origin = "https://login.example.com"
	tests := []struct {
		name     string
		noOrigin bool
		body     map[string]any
	}{
		{
			name: "return_target on another origin",
			body: map[string]any{"action": "sso", "sso_provider_id": "google", "return_target": "https://evil.example.com/login"},
		},
		{
			// The request origin sits in the userinfo part; the host is foreign.
			name: "return_target with the origin as userinfo",
			body: map[string]any{"action": "sso", "sso_provider_id": "google", "return_target": "https://login.example.com@evil.example.com/login"},
		},
		{
			// The host is the origin, but no page URL carries userinfo.
			name: "return_target with userinfo on the origin host",
			body: map[string]any{"action": "sso", "sso_provider_id": "google", "return_target": "https://evil.example.com@login.example.com/login"},
		},
		{
			name: "return_target missing",
			body: map[string]any{"action": "sso", "sso_provider_id": "google"},
		},
		{
			name: "return_target relative",
			body: map[string]any{"action": "sso", "sso_provider_id": "google", "return_target": "/login?flow=flow_1"},
		},
		{
			name:     "no request origin",
			noOrigin: true,
			body:     map[string]any{"action": "sso", "sso_provider_id": "google", "return_target": origin + "/login"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ts := newTestServer(t)
			state := &domain.FlowState{ID: "flow_1", ProjectID: "proj_1", SessionID: "sess_1", IssuedAt: time.Now()}
			requestOrigin := origin
			if tt.noOrigin {
				requestOrigin = ""
			} else {
				ts.projects.EXPECT().Get(gomock.Any(), "proj_1").Return(&domain.Project{PreviewOrigins: []string{origin}}, nil)
			}

			resp, body := doRequestWithOrigin(t, http.MethodPost, ts.srv.URL+"/flow/flow_1/submit", tt.body, ts.sealCookie(t, state), requestOrigin)
			require.Equal(t, http.StatusBadRequest, resp.StatusCode, string(body))
			require.Empty(t, ts.fake.gotSubmitReq.Action, "no sign-in is started")
		})
	}
}

// TestSubmitFlowStep_UnknownPropertiesReturnError covers #1103: a submit body
// keying its values under an unrecognised top-level property (e.g. "data"
// instead of "fields") used to be silently accepted with the fields ignored,
// so the resulting empty submission came back as a 200 with a misleading
// "value missing" step error instead of a request error.
func TestSubmitFlowStep_UnknownPropertiesReturnError(t *testing.T) {
	ts := newTestServer(t)
	state := &domain.FlowState{ID: "flow_1", IssuedAt: time.Now()}
	cookieVal := ts.sealCookie(t, state)

	resp, body := doRequest(t, http.MethodPost, ts.srv.URL+"/flow/flow_1/submit", map[string]any{
		"action": "submit",
		"data":   map[string]any{"identifier": "alice@example.com"},
	}, cookieVal)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d (body = %s)", resp.StatusCode, http.StatusBadRequest, body)
	}
}

func TestGetFlowStep_ReturnsCurrentStep(t *testing.T) {
	ts := newTestServer(t)
	state := &domain.FlowState{
		ID:           "flow_1",
		ProjectID:    "proj_1",
		SessionID:    "sess_1",
		IssuedAt:     time.Now(),
		FlowProgress: domain.FlowProgress{CurrentStep: "identify"},
	}
	cookieVal := ts.sealCookie(t, state)
	ts.fake.getResult = domain.FlowStepResult{State: state, Step: &domain.FlowStep{Name: "identify"}}

	resp, body := doRequest(t, http.MethodGet, ts.srv.URL+"/flow/flow_1", nil, cookieVal)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, body = %s", resp.StatusCode, body)
	}
	var fr gen.FlowResponse
	if err := json.Unmarshal(body, &fr); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if fr.Step.Name != "identify" {
		t.Errorf("step name = %q, want identify", fr.Step.Name)
	}
}

func TestGetFlowStep_TerminalReturns410(t *testing.T) {
	ts := newTestServer(t)
	state := &domain.FlowState{ID: "flow_1", IssuedAt: time.Now()}
	cookieVal := ts.sealCookie(t, state)

	complete := domain.FlowStepCompleteShow
	ts.fake.getResult = domain.FlowStepResult{
		State: state,
		Step:  &domain.FlowStep{Name: "done", Complete: &complete},
	}

	resp, _ := doRequest(t, http.MethodGet, ts.srv.URL+"/flow/flow_1", nil, cookieVal)
	if resp.StatusCode != http.StatusGone {
		t.Fatalf("status = %d, want 410", resp.StatusCode)
	}
}

// A reload racing a submit must not roll the cookie back to the step before
// the submit.
func TestGetFlowStep_PlainRenderLeavesCookie(t *testing.T) {
	ts := newTestServer(t)
	state := &domain.FlowState{ID: "flow_1", ProjectID: "proj_1", IssuedAt: time.Now()}
	cookieVal := ts.sealCookie(t, state)
	ts.fake.getResult = domain.FlowStepResult{State: state, Step: &domain.FlowStep{Name: "identify"}}

	resp, body := doRequest(t, http.MethodGet, ts.srv.URL+"/flow/flow_1", nil, cookieVal)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, body = %s", resp.StatusCode, body)
	}
	if got := resp.Header.Values("Set-Cookie"); len(got) != 0 {
		t.Errorf("expected no Set-Cookie, got %q", got)
	}
}

func TestGetFlowStep_SSOResolvedRenderResealsCookie(t *testing.T) {
	ts := newTestServer(t)
	state := &domain.FlowState{ID: "flow_1", ProjectID: "proj_1", IssuedAt: time.Now()}
	cookieVal := ts.sealCookie(t, state)
	ts.fake.getResult = domain.FlowStepResult{State: state, Step: &domain.FlowStep{Name: "identify"}, Reseal: true}

	resp, body := doRequest(t, http.MethodGet, ts.srv.URL+"/flow/flow_1", nil, cookieVal)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, body = %s", resp.StatusCode, body)
	}
	got := resp.Header.Get("Set-Cookie")
	if !strings.Contains(got, "_zflow=") || strings.Contains(got, "Max-Age=0") {
		t.Errorf("expected a re-sealed _zflow cookie, got %q", got)
	}
}

// A render that resolved a parked SSO identity into a sign-in lands on the
// terminal step with a handoff token: that is a 200 with the terminal cookie,
// not the 410 a flow completed before this request gets.
func TestGetFlowStep_ResolvedHandoffReturns200WithTerminalCookie(t *testing.T) {
	ts := newTestServer(t)
	state := &domain.FlowState{ID: "flow_1", ProjectID: "proj_1", IssuedAt: time.Now()}
	cookieVal := ts.sealCookie(t, state)

	complete := domain.FlowStepCompleteShow
	ts.fake.getResult = domain.FlowStepResult{
		State:                 state,
		Step:                  &domain.FlowStep{Name: "done", Complete: &complete},
		HandoffToken:          "ht_abc",
		HandoffTokenExpiresAt: time.Now().Add(time.Minute),
	}

	resp, body := doRequest(t, http.MethodGet, ts.srv.URL+"/flow/flow_1", nil, cookieVal)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, body = %s", resp.StatusCode, body)
	}
	if got := resp.Header.Get("Set-Cookie"); !strings.Contains(got, "Max-Age=0") {
		t.Errorf("expected the terminal cookie, got %q", got)
	}
	// The handoff token is a single-use credential: never stored.
	if got := resp.Header.Get("Cache-Control"); got != "private, no-store" {
		t.Errorf("Cache-Control = %q, want private, no-store", got)
	}
	var fr gen.FlowResponse
	if err := json.Unmarshal(body, &fr); err != nil {
		t.Fatalf("unmarshal: %v (body=%s)", err, body)
	}
	if got, ok := fr.HandoffToken.Get(); !ok || got != "ht_abc" {
		t.Errorf("handoff_token = %v (set=%t), want ht_abc", got, ok)
	}
}

// The handoff is already committed and single use, and the terminal cookie
// only clears: a failing seal must not cost the client its handoff token.
func TestGetFlowStep_ResolvedHandoffSurvivesSealFailure(t *testing.T) {
	ts := newTestServerSealing(t, domain.ErrInternal(errors.New("key service down")))
	state := &domain.FlowState{ID: "flow_1", ProjectID: "proj_1", IssuedAt: time.Now()}
	cookieVal := ts.sealCookie(t, state)

	complete := domain.FlowStepCompleteShow
	ts.fake.getResult = domain.FlowStepResult{
		State:                 state,
		Step:                  &domain.FlowStep{Name: "done", Complete: &complete},
		HandoffToken:          "ht_abc",
		HandoffTokenExpiresAt: time.Now().Add(time.Minute),
	}

	resp, body := doRequest(t, http.MethodGet, ts.srv.URL+"/flow/flow_1", nil, cookieVal)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, body = %s", resp.StatusCode, body)
	}
	if got := resp.Header.Get("Set-Cookie"); !strings.Contains(got, "Max-Age=0") {
		t.Errorf("expected the terminal cookie, got %q", got)
	}
	var fr gen.FlowResponse
	if err := json.Unmarshal(body, &fr); err != nil {
		t.Fatalf("unmarshal: %v (body=%s)", err, body)
	}
	if got, ok := fr.HandoffToken.Get(); !ok || got != "ht_abc" {
		t.Errorf("handoff_token = %v (set=%t), want ht_abc", got, ok)
	}
}

func TestGetFlowStep_RestartRequiredReturns409(t *testing.T) {
	ts := newTestServer(t)
	state := &domain.FlowState{ID: "flow_1", ProjectID: "proj_1", IssuedAt: time.Now()}
	cookieVal := ts.sealCookie(t, state)
	ts.fake.getErr = domain.ErrFlowRestartRequired()

	resp, body := doRequest(t, http.MethodGet, ts.srv.URL+"/flow/flow_1", nil, cookieVal)
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (body = %s)", resp.StatusCode, body)
	}
	if !strings.Contains(string(body), "flow.restart_required") {
		t.Errorf("expected the restart code, got %s", body)
	}
}

// A submit on an attempt another request already handed off is a conflict,
// as on the attempt endpoints, not an internal error.
func TestSubmitFlowStep_HandedOffAttemptReturns409(t *testing.T) {
	ts := newTestServer(t)
	state := &domain.FlowState{ID: "flow_1", ProjectID: "proj_1", SessionID: "sess_1", IssuedAt: time.Now()}
	cookieVal := ts.sealCookie(t, state)
	ts.fake.submitErr = domain.ErrAuthAttemptAlreadyHandedOff()

	resp, body := doRequest(t, http.MethodPost, ts.srv.URL+"/flow/flow_1/submit", map[string]any{
		"action": "submit",
		"fields": map[string]any{"identifier": "alice@example.com"},
	}, cookieVal)
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (body = %s)", resp.StatusCode, body)
	}
	if !strings.Contains(string(body), "att.already_handed_off") {
		t.Errorf("expected the handed-off code, got %s", body)
	}
}
