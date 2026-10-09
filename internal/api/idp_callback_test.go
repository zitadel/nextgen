package api_test

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/service"
)

type stubSSOCallback struct {
	calls int
	in    service.FlowSSOCallbackInput
	out   service.FlowSSOCallbackOutput
	err   error
}

func (s *stubSSOCallback) Process(_ context.Context, in service.FlowSSOCallbackInput) (service.FlowSSOCallbackOutput, error) {
	s.calls++
	s.in = in
	return s.out, s.err
}

// callbackMux mounts the handler the way the server does: the connection slug
// is a path wildcard, which only a ServeMux resolves.
func callbackMux(t *testing.T, handler http.Handler) http.Handler {
	t.Helper()
	mux := http.NewServeMux()
	mux.Handle(api.IDPCallbackPattern, handler)
	mux.Handle(api.IDPCallbackUpstreamPattern, handler)
	return mux
}

func TestIDPCallbackHandler(t *testing.T) {
	t.Parallel()
	const returnTarget = "https://app.example.com/login?flow=flow-1"
	tests := []struct {
		name   string
		target string
		cookie *http.Cookie
		err    error

		wantStatus   int
		wantLocation string
		wantIn       service.FlowSSOCallbackInput
	}{
		{
			name:   "code and state redirect to the return target",
			target: api.IDPCallbackPath("google") + "?state=proj-1.rand&code=the-code",
			// No request host on the context defaults to secure, so the
			// handler reads the `__Host-` name, as an https submit set it.
			cookie:       &http.Cookie{Name: "__Host-_zsso", Value: "the-nonce"},
			wantStatus:   http.StatusSeeOther,
			wantLocation: returnTarget,
			wantIn:       service.FlowSSOCallbackInput{ConnectionSlug: "google", State: "proj-1.rand", Code: "the-code", BindingNonce: "the-nonce"},
		},
		{
			name:         "the SDK proxy's stripped path names the connection too",
			target:       api.IDPCallbackUpstreamPath("google") + "?state=proj-1.rand&code=the-code",
			cookie:       &http.Cookie{Name: "__Host-_zsso", Value: "the-nonce"},
			wantStatus:   http.StatusSeeOther,
			wantLocation: returnTarget,
			wantIn:       service.FlowSSOCallbackInput{ConnectionSlug: "google", State: "proj-1.rand", Code: "the-code", BindingNonce: "the-nonce"},
		},
		{
			name:         "the RFC 9207 iss is handed through",
			target:       api.IDPCallbackPath("google") + "?state=proj-1.rand&code=the-code&iss=https%3A%2F%2Faccounts.google.com",
			cookie:       &http.Cookie{Name: "__Host-_zsso", Value: "the-nonce"},
			wantStatus:   http.StatusSeeOther,
			wantLocation: returnTarget,
			wantIn:       service.FlowSSOCallbackInput{ConnectionSlug: "google", State: "proj-1.rand", Code: "the-code", BindingNonce: "the-nonce", Issuer: "https://accounts.google.com"},
		},
		{
			name:         "provider error params are handed through",
			target:       api.IDPCallbackPath("google") + "?state=proj-1.rand&error=access_denied&error_description=the-desc&error_uri=https%3A%2F%2Fp.example.com%2Fhelp",
			cookie:       &http.Cookie{Name: "__Host-_zsso", Value: "the-nonce"},
			wantStatus:   http.StatusSeeOther,
			wantLocation: returnTarget,
			wantIn: service.FlowSSOCallbackInput{
				ConnectionSlug:   "google",
				State:            "proj-1.rand",
				BindingNonce:     "the-nonce",
				Error:            "access_denied",
				ErrorDescription: "the-desc",
				ErrorURI:         "https://p.example.com/help",
			},
		},
		{
			name:         "a missing cookie reads as an empty nonce",
			target:       api.IDPCallbackPath("google") + "?state=proj-1.rand&code=the-code",
			wantStatus:   http.StatusSeeOther,
			wantLocation: returnTarget,
			wantIn:       service.FlowSSOCallbackInput{ConnectionSlug: "google", State: "proj-1.rand", Code: "the-code"},
		},
		{
			name:         "a cookie under the wrong name is not read",
			target:       api.IDPCallbackPath("google") + "?state=proj-1.rand&code=the-code",
			cookie:       &http.Cookie{Name: "_zsso", Value: "the-nonce"},
			wantStatus:   http.StatusSeeOther,
			wantLocation: returnTarget,
			wantIn:       service.FlowSSOCallbackInput{ConnectionSlug: "google", State: "proj-1.rand", Code: "the-code"},
		},
		{
			name:       "an invalid state answers the uniform page",
			target:     api.IDPCallbackPath("google") + "?state=unknown&code=the-code",
			err:        domain.ErrSSOStateInvalid(),
			wantStatus: http.StatusBadRequest,
			wantIn:     service.FlowSSOCallbackInput{ConnectionSlug: "google", State: "unknown", Code: "the-code"},
		},
		{
			name:       "an internal error answers the same page",
			target:     api.IDPCallbackPath("google") + "?state=proj-1.rand&code=the-code",
			err:        domain.ErrInternal(nil),
			wantStatus: http.StatusInternalServerError,
			wantIn:     service.FlowSSOCallbackInput{ConnectionSlug: "google", State: "proj-1.rand", Code: "the-code"},
		},
	}
	var errorPage string
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			stub := &stubSSOCallback{out: service.FlowSSOCallbackOutput{ReturnTarget: returnTarget}, err: tt.err}
			req := httptest.NewRequest(http.MethodGet, tt.target, nil)
			if tt.cookie != nil {
				req.AddCookie(tt.cookie)
			}
			rec := httptest.NewRecorder()
			callbackMux(t, api.NewIDPCallbackHandler(stub)).ServeHTTP(rec, req)

			assert.Equal(t, tt.wantStatus, rec.Code)
			assert.Equal(t, tt.wantLocation, rec.Header().Get("Location"))
			assert.Equal(t, 1, stub.calls)
			assert.Equal(t, tt.wantIn, stub.in)
			assert.Equal(t, "private, no-store", rec.Header().Get("Cache-Control"))
			if tt.wantStatus == http.StatusSeeOther {
				return
			}
			// One page for every failure, whatever the cause: the body reflects
			// nothing from the request or the error.
			assert.NotContains(t, rec.Body.String(), "unknown")
			if errorPage == "" {
				errorPage = rec.Body.String()
				assert.Contains(t, errorPage, "could not be completed")
				return
			}
			assert.Equal(t, errorPage, rec.Body.String())
		})
	}
}

// A loopback http submit set the cookie without the `__Host-` prefix (Safari
// refuses Secure cookies on http://localhost), so the callback on the same
// scheme reads that name.
func TestIDPCallbackHandler_LoopbackHTTPReadsTheUnprefixedCookie(t *testing.T) {
	t.Parallel()
	stub := &stubSSOCallback{out: service.FlowSSOCallbackOutput{ReturnTarget: "http://localhost:3000/login"}}
	handler := api.WithRequestHostMiddleware(callbackMux(t, api.NewIDPCallbackHandler(stub)))

	req := httptest.NewRequest(http.MethodGet, "http://localhost:8080"+api.IDPCallbackPath("google")+"?state=proj-1.rand&code=the-code", nil)
	req.AddCookie(&http.Cookie{Name: "_zsso", Value: "the-nonce"})
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusSeeOther, rec.Code)
	assert.Equal(t, "the-nonce", stub.in.BindingNonce)
	assert.Equal(t, "google", stub.in.ConnectionSlug)
}

func TestIDPCallbackHandler_RefusesNonGET(t *testing.T) {
	t.Parallel()
	stub := &stubSSOCallback{}
	req := httptest.NewRequest(http.MethodPost, api.IDPCallbackPath("google"), nil)
	rec := httptest.NewRecorder()
	callbackMux(t, api.NewIDPCallbackHandler(stub)).ServeHTTP(rec, req)

	require.Equal(t, http.StatusMethodNotAllowed, rec.Code)
	assert.Equal(t, http.MethodGet, rec.Header().Get("Allow"))
	assert.Zero(t, stub.calls)
}

// A cancelled request is the client leaving and is not logged as a bug. A
// deadline is not the client's doing and still is.
func TestIDPCallbackHandler_LogsUnlessCancelled(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		ctx       func(context.Context) (context.Context, context.CancelFunc)
		cause     error
		wantError bool
	}{
		{
			name: "cancelled",
			ctx: func(ctx context.Context) (context.Context, context.CancelFunc) {
				ctx, cancel := context.WithCancel(ctx)
				cancel()
				return ctx, cancel
			},
			cause: context.Canceled,
		},
		{
			name: "past its deadline",
			ctx: func(ctx context.Context) (context.Context, context.CancelFunc) {
				return context.WithDeadline(ctx, time.Now().Add(-time.Second))
			},
			cause:     context.DeadlineExceeded,
			wantError: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			var logs bytes.Buffer
			ctx, cancel := tt.ctx(zlog.WithLoggingContext(t.Context(), slog.New(slog.NewTextHandler(&logs, nil))))
			defer cancel()
			stub := &stubSSOCallback{err: fmt.Errorf("failed to set sso callback result: %w", tt.cause)}
			req := httptest.NewRequestWithContext(ctx, http.MethodGet, api.IDPCallbackPath("google")+"?state=proj-1.rand&code=the-code", nil)
			rec := httptest.NewRecorder()
			callbackMux(t, api.NewIDPCallbackHandler(stub)).ServeHTTP(rec, req)

			assert.Equal(t, http.StatusInternalServerError, rec.Code)
			assert.Equal(t, tt.wantError, bytes.Contains(logs.Bytes(), []byte("sso callback processing failed")))
		})
	}
}

// The request log and the audit middleware plant the operation id before the
// handler runs and read it after.
func TestIDPCallbackHandler_SetsTheOperationID(t *testing.T) {
	t.Parallel()
	ctx := middleware.WithOperationIDContext(t.Context(), "")
	stub := &stubSSOCallback{out: service.FlowSSOCallbackOutput{ReturnTarget: "https://app.example.com/login"}}
	req := httptest.NewRequestWithContext(ctx, http.MethodGet, api.IDPCallbackPath("google")+"?state=proj-1.rand&code=the-code", nil)
	callbackMux(t, api.NewIDPCallbackHandler(stub)).ServeHTTP(httptest.NewRecorder(), req)

	operationID, _ := middleware.GetOperationIDContext(ctx)
	assert.Equal(t, "idpCallback", operationID)
}
