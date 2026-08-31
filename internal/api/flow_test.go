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
	gen "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/oidc/v3/pkg/op"
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
	srv     *httptest.Server
	crypter crypto.Crypter
	fake    *fakeFlowSvc
}

func newTestServer(t *testing.T) *testServer {
	t.Helper()

	crypter := op.NewAES256GCMCrypto(fixedKey, "")

	mock := gomock.NewController(t)
	tokenService := mocks.NewMockTokenService(mock)
	keyService := mocks.NewMockKeyService(mock)
	keyService.EXPECT().GetCrypter(gomock.Any(), gomock.Any(), gomock.Any()).Return(crypter, nil).AnyTimes()
	keyService.EXPECT().GetProjectCrypter(gomock.Any(), gomock.Any(), gomock.Any()).Return(crypter, nil).AnyTimes()

	fake := &fakeFlowSvc{}
	handler := api.NewHandler(fake, stubAuthAttempt{}, nil, nil, nil, nil, nil, nil, nil, nil, nil, tokenService, keyService, nil, nil, "")
	oas, err := gen.NewServer(
		handler,
		api.NewSecurityHandler(tokenService),
		gen.WithErrorHandler(api.OgenErrorHandler),
	)
	require.NoError(t, err)
	srv := httptest.NewServer(oas)
	t.Cleanup(srv.Close)
	return &testServer{srv: srv, crypter: crypter, fake: fake}
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
