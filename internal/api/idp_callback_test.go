package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	"github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/instrumentation/zotel"
	"github.com/zitadel/nextgen/internal/service"
)

// spanExporter sets the global provider once, when the test binary starts:
// the package tracer delegates to the first provider set in the process.
var spanExporter = func() *tracetest.InMemoryExporter {
	exporter := tracetest.NewInMemoryExporter()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(
		sdktrace.WithSyncer(exporter),
		sdktrace.WithSampler(zotel.NewSampler(1.0)),
	))
	return exporter
}()

type stubSSOCallback struct {
	calls int
	in    service.FlowSSOCallbackInput
	out   service.FlowSSOCallbackOutput
	err   error
	// serverSpan is the server span context Process found in the holder.
	serverSpan trace.SpanContext
}

func (s *stubSSOCallback) Process(ctx context.Context, in service.FlowSSOCallbackInput) (service.FlowSSOCallbackOutput, error) {
	s.calls++
	s.in = in
	s.serverSpan = middleware.GetServerSpanContext(ctx)
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
		// storedTarget replaces the stored return target when set.
		storedTarget string

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
			// A target stored before the start-of-sign-in check was as strict
			// as it is now is never redirected to.
			name:         "a stored return target that no longer passes the check answers the same page",
			target:       api.IDPCallbackPath("google") + "?state=proj-1.rand&code=the-code",
			storedTarget: "https://app.example.com//evil.example/login",
			wantStatus:   http.StatusInternalServerError,
			wantIn:       service.FlowSSOCallbackInput{ConnectionSlug: "google", State: "proj-1.rand", Code: "the-code"},
		},
		{
			name:       "an internal error answers the same page",
			target:     api.IDPCallbackPath("google") + "?state=proj-1.rand&code=the-code",
			err:        domain.ErrInternal(nil),
			wantStatus: http.StatusInternalServerError,
			wantIn:     service.FlowSSOCallbackInput{ConnectionSlug: "google", State: "proj-1.rand", Code: "the-code"},
		},
	}
	errorPages := map[int]string{}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			stored := returnTarget
			if tt.storedTarget != "" {
				stored = tt.storedTarget
			}
			stub := &stubSSOCallback{out: service.FlowSSOCallbackOutput{ReturnTarget: stored}, err: tt.err}
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
			// One page per status, whatever the cause: the body reflects
			// nothing from the request or the error.
			body := rec.Body.String()
			assert.Equal(t, "text/html; charset=utf-8", rec.Header().Get("Content-Type"))
			assert.Contains(t, body, "could not be completed")
			for _, reflected := range []string{"unknown", "the-code", "proj-1.rand", "google", "evil.example"} {
				assert.NotContains(t, body, reflected)
			}
			if page, ok := errorPages[tt.wantStatus]; ok {
				assert.Equal(t, page, body)
				return
			}
			errorPages[tt.wantStatus] = body
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

// serveCallbackLogged serves req behind the request logging the server mounts
// the callback with, and returns the response and the error line, parsed, or
// nil when the request got none.
func serveCallbackLogged(t *testing.T, handler http.Handler, req *http.Request) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	var logs bytes.Buffer
	ctx := zlog.WithLoggingContext(req.Context(), slog.New(slog.NewJSONHandler(&logs, nil)))
	rec := httptest.NewRecorder()
	middleware.WithLogging(handler).ServeHTTP(rec, req.WithContext(ctx))

	var errorLine map[string]any
	for line := range bytes.Lines(logs.Bytes()) {
		var record map[string]any
		require.NoError(t, json.Unmarshal(line, &record))
		if record["msg"] == "api error" {
			require.Nil(t, errorLine, "one error line per request")
			errorLine = record
		}
	}
	return rec, errorLine
}

func TestIDPCallbackHandler_RefusesNonGET(t *testing.T) {
	t.Parallel()
	stub := &stubSSOCallback{}
	req := httptest.NewRequest(http.MethodPost, api.IDPCallbackPath("google"), nil)
	rec, line := serveCallbackLogged(t, callbackMux(t, api.NewIDPCallbackHandler(stub)), req)

	require.Equal(t, http.StatusMethodNotAllowed, rec.Code)
	assert.Equal(t, http.MethodGet, rec.Header().Get("Allow"))
	assert.Zero(t, stub.calls)
	require.NotNil(t, line)
	assert.Equal(t, domain.ErrRequestMethodNotAllowed().Code, line["error"].(map[string]any)["code"])
}

// Every failed callback gets one error line with the cause the page does not
// show: Info for a refused state, Error for a bug in the process, and Warn
// when the client had already left.
func TestIDPCallbackHandler_RecordsTheErrorItAnswers(t *testing.T) {
	t.Parallel()
	const refusedTarget = "https://app.example.com//evil.example/login"
	processFailed := fmt.Errorf("failed to set sso callback result: %w", errors.New("connection reset"))
	tests := []struct {
		name         string
		err          error
		storedTarget string
		canceled     bool
		wantStatus   int
		wantLevel    string
		wantCode     string
		wantParent   string
	}{
		{name: "an invalid state", err: domain.ErrSSOStateInvalid(), wantStatus: http.StatusBadRequest, wantLevel: "INFO", wantCode: domain.ErrSSOStateInvalid().Code},
		{name: "a failed process", err: processFailed, wantStatus: http.StatusInternalServerError, wantLevel: "ERROR", wantCode: "internal", wantParent: "connection reset"},
		{name: "a failed process after the client left", err: processFailed, canceled: true, wantStatus: http.StatusInternalServerError, wantLevel: "WARN", wantCode: "internal", wantParent: "connection reset"},
		{name: "a refused return target", storedTarget: refusedTarget, wantStatus: http.StatusInternalServerError, wantLevel: "ERROR", wantCode: "internal"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			if tt.canceled {
				cancel()
			}
			stored := "https://app.example.com/login"
			if tt.storedTarget != "" {
				stored = tt.storedTarget
			}
			stub := &stubSSOCallback{out: service.FlowSSOCallbackOutput{ReturnTarget: stored}, err: tt.err}
			req := httptest.NewRequestWithContext(ctx, http.MethodGet, api.IDPCallbackPath("google")+"?state=proj-1.rand&code=the-code", nil)
			rec, line := serveCallbackLogged(t, callbackMux(t, api.NewIDPCallbackHandler(stub)), req)

			assert.Equal(t, tt.wantStatus, rec.Code)
			require.NotNil(t, line)
			assert.Equal(t, tt.wantLevel, line["level"])
			assert.EqualValues(t, tt.wantStatus, line["status"])
			assert.Equal(t, "idpCallback", line["operation_id"])
			logged := line["error"].(map[string]any)
			assert.Equal(t, tt.wantCode, logged["code"])
			if tt.wantParent != "" {
				assert.Contains(t, logged["parent"], tt.wantParent)
			}
			if tt.storedTarget != "" {
				assert.Equal(t, tt.storedTarget, line["return_target"])
			}
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

// The route is not an ogen operation, so it starts its own server span: the
// service and storage spans below it are sampled with it, and the request
// line reads its IDs from the holder.
func TestIDPCallbackHandler_StartsAServerSpan(t *testing.T) {
	t.Parallel()
	ctx := middleware.WithOperationIDContext(t.Context(), "")
	stub := &stubSSOCallback{out: service.FlowSSOCallbackOutput{ReturnTarget: "https://app.example.com/login"}}
	req := httptest.NewRequestWithContext(ctx, http.MethodGet, api.IDPCallbackPath("google")+"?state=proj-1.rand&code=the-code", nil)
	callbackMux(t, api.NewIDPCallbackHandler(stub)).ServeHTTP(httptest.NewRecorder(), req)

	require.True(t, stub.serverSpan.IsValid())
	// Other tests in this package run the handler in parallel, so only the
	// spans of this request's trace are looked at.
	var spans []tracetest.SpanStub
	for _, s := range spanExporter.GetSpans() {
		if s.SpanContext.TraceID() == stub.serverSpan.TraceID() {
			spans = append(spans, s)
		}
	}
	require.Len(t, spans, 1)
	assert.Equal(t, "idpCallback", spans[0].Name)
	assert.Equal(t, trace.SpanKindServer, spans[0].SpanKind)
	assert.Equal(t, stub.serverSpan, spans[0].SpanContext)
}
