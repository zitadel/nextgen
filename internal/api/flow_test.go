package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	apigen "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/cookie"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

type fakeFlowService struct {
	resolveOut *domain.FlowDefinition
	resolveErr error

	startIn  service.StartFlowRequest
	startOut domain.FlowStepResult
	startErr error

	submitIn  service.SubmitFlowRequest
	submitOut domain.FlowStepResult
	submitErr error

	getStepIn  service.GetFlowStepRequest
	getStepOut domain.FlowStepResult
	getStepErr error
}

func (f *fakeFlowService) Resolve(_ context.Context, _ service.ResolveFlowRequest) (*domain.FlowDefinition, error) {
	return f.resolveOut, f.resolveErr
}

func (f *fakeFlowService) Start(_ context.Context, req service.StartFlowRequest) (domain.FlowStepResult, error) {
	f.startIn = req
	return f.startOut, f.startErr
}

func (f *fakeFlowService) Submit(_ context.Context, req service.SubmitFlowRequest) (domain.FlowStepResult, error) {
	f.submitIn = req
	return f.submitOut, f.submitErr
}

func (f *fakeFlowService) GetStep(_ context.Context, req service.GetFlowStepRequest) (domain.FlowStepResult, error) {
	f.getStepIn = req
	return f.getStepOut, f.getStepErr
}

var _ service.FlowService = (*fakeFlowService)(nil)

func testSealer(t *testing.T) *cookie.Sealer {
	t.Helper()
	var k cookie.Key
	for i := range k {
		k[i] = byte(i)
	}
	s, err := cookie.NewSealer(k)
	if err != nil {
		t.Fatalf("new sealer: %v", err)
	}
	return s
}

func mustSealState(t *testing.T, s *cookie.Sealer, state *domain.FlowState) string {
	t.Helper()
	payload, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("marshal state: %v", err)
	}
	v, err := s.Seal(payload)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	return v
}

func newTestHandler(svc service.FlowService, sealer *cookie.Sealer, now func() time.Time) *Handler {
	return NewHandler(svc, nil, sealer, now)
}

func TestCreateFlow_SealsCookieAndReturnsFlowResponse(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	def := &domain.FlowDefinition{ID: "def-1", ProjectID: "proj-1", UserSchema: "https://example/schema"}
	state := &domain.FlowState{
		ID:        "flow_abc",
		ProjectID: "proj-1",
		FlowProgress: domain.FlowProgress{
			DefinitionID: "def-1",
			Purpose:      domain.FlowDefinitionPurposeLogin,
			CurrentStep:  "identifier",
		},
		IssuedAt:  now,
		SessionID: "sess_xyz",
	}
	step := &domain.FlowStep{Name: "identifier"}
	svc := &fakeFlowService{
		resolveOut: def,
		startOut:   domain.FlowStepResult{State: state, Step: step},
	}

	h := newTestHandler(svc, testSealer(t), func() time.Time { return now })

	resp, err := h.CreateFlow(context.Background(), &apigen.CreateFlowRequest{
		ProjectID: "proj-1",
		Purpose:   apigen.CreateFlowRequestPurposeLogin,
	})
	if err != nil {
		t.Fatalf("CreateFlow: %v", err)
	}
	headers, ok := resp.(*apigen.FlowResponseHeaders)
	if !ok {
		t.Fatalf("got %T, want *FlowResponseHeaders", resp)
	}
	if headers.Response.ID != "flow_abc" {
		t.Errorf("response id = %q, want flow_abc", headers.Response.ID)
	}
	if headers.Response.SessionID != "sess_xyz" {
		t.Errorf("response session id = %q, want sess_xyz", headers.Response.SessionID)
	}
	setCookie, ok := headers.SetCookie.Get()
	if !ok {
		t.Fatalf("Set-Cookie not set")
	}
	if !strings.HasPrefix(setCookie, "_zflow=") {
		t.Errorf("Set-Cookie = %q, want _zflow=… prefix", setCookie)
	}
	if !strings.Contains(setCookie, "Max-Age=600") {
		t.Errorf("Set-Cookie missing Max-Age=600: %q", setCookie)
	}
}

func TestCreateFlow_ThreadsRedirectURI(t *testing.T) {
	now := time.Now()
	def := &domain.FlowDefinition{ID: "def-1"}
	state := &domain.FlowState{ID: "flow_x", IssuedAt: now}
	svc := &fakeFlowService{
		resolveOut: def,
		startOut:   domain.FlowStepResult{State: state, Step: &domain.FlowStep{Name: "x"}},
	}
	h := newTestHandler(svc, testSealer(t), func() time.Time { return now })

	req := &apigen.CreateFlowRequest{
		ProjectID: "proj-1",
		Purpose:   apigen.CreateFlowRequestPurposeLogin,
	}
	uri, err := url.Parse("https://app.example/callback")
	if err != nil {
		t.Fatalf("parse URI: %v", err)
	}
	req.RedirectURI = apigen.NewOptURI(*uri)

	if _, err := h.CreateFlow(context.Background(), req); err != nil {
		t.Fatalf("CreateFlow: %v", err)
	}
	if svc.startIn.RedirectURI == nil {
		t.Fatalf("RedirectURI not threaded")
	}
	if *svc.startIn.RedirectURI != "https://app.example/callback" {
		t.Errorf("RedirectURI = %q, want https://app.example/callback", *svc.startIn.RedirectURI)
	}
}

func TestCreateFlow_PurposeMismatchMapsTo400(t *testing.T) {
	svc := &fakeFlowService{resolveErr: domain.ErrFlowDefinitionPurposeMismatch()}
	h := newTestHandler(svc, testSealer(t), time.Now)
	resp, err := h.CreateFlow(context.Background(), &apigen.CreateFlowRequest{
		ProjectID: "proj-1",
		Purpose:   apigen.CreateFlowRequestPurposeLogin,
	})
	if err != nil {
		t.Fatalf("CreateFlow: %v", err)
	}
	status, ok := resp.(*apigen.ErrorDetailsStatusCode)
	if !ok {
		t.Fatalf("got %T, want *ErrorDetailsStatusCode", resp)
	}
	if status.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", status.StatusCode)
	}
	if string(status.Response.Code) != "flow.purpose_mismatch" {
		t.Errorf("code = %q, want flow.purpose_mismatch", status.Response.Code)
	}
}

func TestSubmitFlowStep_HappyPathRotatesCookie(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	state := &domain.FlowState{
		ID:        "flow_1",
		ProjectID: "proj-1",
		IssuedAt:  now,
		FlowProgress: domain.FlowProgress{
			DefinitionID: "def-1",
			Purpose:      domain.FlowDefinitionPurposeLogin,
			CurrentStep:  "identifier",
		},
	}
	sealer := testSealer(t)
	zflow := mustSealState(t, sealer, state)

	advanced := *state
	advanced.IssuedAt = now.Add(time.Second)
	advanced.CurrentStep = "password"
	svc := &fakeFlowService{
		submitOut: domain.FlowStepResult{State: &advanced, Step: &domain.FlowStep{Name: "password"}},
	}
	h := newTestHandler(svc, sealer, func() time.Time { return now })

	resp, err := h.SubmitFlowStep(context.Background(), &apigen.FlowSubmitRequest{Action: "submit"}, apigen.SubmitFlowStepParams{
		ID:    "flow_1",
		Zflow: zflow,
	})
	if err != nil {
		t.Fatalf("SubmitFlowStep: %v", err)
	}
	ok, isOK := resp.(*apigen.SubmitFlowStepOK)
	if !isOK {
		t.Fatalf("got %T, want *SubmitFlowStepOK", resp)
	}
	cookieVal, set := ok.SetCookie.Get()
	if !set || !strings.HasPrefix(cookieVal, "_zflow=") {
		t.Errorf("Set-Cookie not rotated: %q", cookieVal)
	}
	if strings.Contains(cookieVal, "Max-Age=0") {
		t.Errorf("non-terminal step cleared cookie: %q", cookieVal)
	}
}

func TestSubmitFlowStep_TerminalClearsCookie(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	state := &domain.FlowState{
		ID:       "flow_t",
		IssuedAt: now,
		FlowProgress: domain.FlowProgress{
			DefinitionID: "def-1",
			Purpose:      domain.FlowDefinitionPurposeLogin,
			CurrentStep:  "done",
		},
	}
	sealer := testSealer(t)
	zflow := mustSealState(t, sealer, state)

	completed := domain.FlowStepCompleteShow
	svc := &fakeFlowService{
		submitOut: domain.FlowStepResult{State: state, Step: &domain.FlowStep{Name: "done", Complete: &completed}},
	}
	h := newTestHandler(svc, sealer, func() time.Time { return now })

	resp, err := h.SubmitFlowStep(context.Background(), &apigen.FlowSubmitRequest{Action: "submit"}, apigen.SubmitFlowStepParams{
		ID:    "flow_t",
		Zflow: zflow,
	})
	if err != nil {
		t.Fatalf("SubmitFlowStep: %v", err)
	}
	ok := resp.(*apigen.SubmitFlowStepOK)
	cookieVal, _ := ok.SetCookie.Get()
	if !strings.Contains(cookieVal, "Max-Age=0") {
		t.Errorf("terminal Set-Cookie should clear: %q", cookieVal)
	}
}

func TestSubmitFlowStep_StepErrorReturns400WithCookie(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	state := &domain.FlowState{ID: "flow_e", IssuedAt: now, FlowProgress: domain.FlowProgress{CurrentStep: "password"}}
	sealer := testSealer(t)
	zflow := mustSealState(t, sealer, state)

	errKey := "invalid_credentials"
	svc := &fakeFlowService{
		submitOut: domain.FlowStepResult{State: state, Step: &domain.FlowStep{Name: "password", Error: &errKey}},
	}
	h := newTestHandler(svc, sealer, func() time.Time { return now })

	resp, err := h.SubmitFlowStep(context.Background(), &apigen.FlowSubmitRequest{Action: "submit"}, apigen.SubmitFlowStepParams{
		ID:    "flow_e",
		Zflow: zflow,
	})
	if err != nil {
		t.Fatalf("SubmitFlowStep: %v", err)
	}
	bad, isBad := resp.(*apigen.SubmitFlowStepBadRequest)
	if !isBad {
		t.Fatalf("got %T, want *SubmitFlowStepBadRequest", resp)
	}
	if _, set := bad.SetCookie.Get(); !set {
		t.Errorf("Set-Cookie should still rotate on step error")
	}
	gotErr, set := bad.Response.Step.Error.Get()
	if !set || gotErr != "invalid_credentials" {
		t.Errorf("step.error = %q (set=%v), want invalid_credentials", gotErr, set)
	}
}

func TestSubmitFlowStep_PathIDMismatchReturns404(t *testing.T) {
	now := time.Now()
	state := &domain.FlowState{ID: "flow_a", IssuedAt: now}
	sealer := testSealer(t)
	zflow := mustSealState(t, sealer, state)

	h := newTestHandler(&fakeFlowService{}, sealer, func() time.Time { return now })
	resp, err := h.SubmitFlowStep(context.Background(), &apigen.FlowSubmitRequest{Action: "submit"}, apigen.SubmitFlowStepParams{
		ID:    "flow_b",
		Zflow: zflow,
	})
	if err != nil {
		t.Fatalf("SubmitFlowStep: %v", err)
	}
	status := resp.(*apigen.ErrorDetailsStatusCode)
	if status.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", status.StatusCode)
	}
	if string(status.Response.Code) != "flow.not_found" {
		t.Errorf("code = %q, want flow.not_found", status.Response.Code)
	}
}

func TestSubmitFlowStep_CookieInvalidReturns401(t *testing.T) {
	h := newTestHandler(&fakeFlowService{}, testSealer(t), time.Now)
	resp, err := h.SubmitFlowStep(context.Background(), &apigen.FlowSubmitRequest{Action: "submit"}, apigen.SubmitFlowStepParams{
		ID:    "flow_a",
		Zflow: "garbage",
	})
	if err != nil {
		t.Fatalf("SubmitFlowStep: %v", err)
	}
	status := resp.(*apigen.ErrorDetailsStatusCode)
	if status.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", status.StatusCode)
	}
	if string(status.Response.Code) != "flow.cookie_invalid" {
		t.Errorf("code = %q, want flow.cookie_invalid", status.Response.Code)
	}
}

func TestSubmitFlowStep_CookieExpiredReturns401(t *testing.T) {
	issued := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	state := &domain.FlowState{ID: "flow_a", IssuedAt: issued}
	sealer := testSealer(t)
	zflow := mustSealState(t, sealer, state)
	stale := issued.Add(flowCookieMaxAge + time.Second)

	h := newTestHandler(&fakeFlowService{}, sealer, func() time.Time { return stale })
	resp, err := h.SubmitFlowStep(context.Background(), &apigen.FlowSubmitRequest{Action: "submit"}, apigen.SubmitFlowStepParams{
		ID:    "flow_a",
		Zflow: zflow,
	})
	if err != nil {
		t.Fatalf("SubmitFlowStep: %v", err)
	}
	status := resp.(*apigen.ErrorDetailsStatusCode)
	if status.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", status.StatusCode)
	}
	if string(status.Response.Code) != "flow.cookie_expired" {
		t.Errorf("code = %q, want flow.cookie_expired", status.Response.Code)
	}
}

func TestGetFlowStep_RendersFlowResponse(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	state := &domain.FlowState{ID: "flow_g", IssuedAt: now, FlowProgress: domain.FlowProgress{CurrentStep: "identifier"}}
	sealer := testSealer(t)
	zflow := mustSealState(t, sealer, state)

	svc := &fakeFlowService{
		getStepOut: domain.FlowStepResult{State: state, Step: &domain.FlowStep{Name: "identifier"}},
	}
	h := newTestHandler(svc, sealer, func() time.Time { return now })
	resp, err := h.GetFlowStep(context.Background(), apigen.GetFlowStepParams{ID: "flow_g", Zflow: zflow})
	if err != nil {
		t.Fatalf("GetFlowStep: %v", err)
	}
	flow, ok := resp.(*apigen.FlowResponse)
	if !ok {
		t.Fatalf("got %T, want *FlowResponse", resp)
	}
	if flow.ID != "flow_g" {
		t.Errorf("id = %q, want flow_g", flow.ID)
	}
	if flow.Step.Name != "identifier" {
		t.Errorf("step name = %q, want identifier", flow.Step.Name)
	}
}

func TestSubmitFlowEvent_HappyPathReturns204(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	state := &domain.FlowState{ID: "flow_v", IssuedAt: now}
	sealer := testSealer(t)
	zflow := mustSealState(t, sealer, state)

	h := newTestHandler(&fakeFlowService{}, sealer, func() time.Time { return now })
	resp, err := h.SubmitFlowEvent(context.Background(), &apigen.FlowEventRequest{Type: apigen.FlowEventRequestTypeTelemetry}, apigen.SubmitFlowEventParams{
		ID:    "flow_v",
		Zflow: zflow,
	})
	if err != nil {
		t.Fatalf("SubmitFlowEvent: %v", err)
	}
	if _, ok := resp.(*apigen.SubmitFlowEventNoContent); !ok {
		t.Fatalf("got %T, want *SubmitFlowEventNoContent", resp)
	}
}

func TestSubmitFlowEvent_InvalidCookieReturns401(t *testing.T) {
	h := newTestHandler(&fakeFlowService{}, testSealer(t), time.Now)
	resp, err := h.SubmitFlowEvent(context.Background(), &apigen.FlowEventRequest{Type: apigen.FlowEventRequestTypeTelemetry}, apigen.SubmitFlowEventParams{
		ID:    "flow_v",
		Zflow: "",
	})
	if err != nil {
		t.Fatalf("SubmitFlowEvent: %v", err)
	}
	status := resp.(*apigen.ErrorDetailsStatusCode)
	if status.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", status.StatusCode)
	}
}
