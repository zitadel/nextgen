package api_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/domain"
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
			target: api.IDPCallbackPath + "?state=proj-1.rand&code=the-code",
			// No request host on the context defaults to secure, so the
			// handler reads the `__Host-` name, as an https submit set it.
			cookie:       &http.Cookie{Name: "__Host-_zsso", Value: "the-nonce"},
			wantStatus:   http.StatusSeeOther,
			wantLocation: returnTarget,
			wantIn:       service.FlowSSOCallbackInput{State: "proj-1.rand", Code: "the-code", BindingNonce: "the-nonce"},
		},
		{
			name:         "provider error params are handed through",
			target:       api.IDPCallbackPath + "?state=proj-1.rand&error=access_denied&error_description=the-desc&error_uri=https%3A%2F%2Fp.example.com%2Fhelp",
			cookie:       &http.Cookie{Name: "__Host-_zsso", Value: "the-nonce"},
			wantStatus:   http.StatusSeeOther,
			wantLocation: returnTarget,
			wantIn: service.FlowSSOCallbackInput{
				State:            "proj-1.rand",
				BindingNonce:     "the-nonce",
				Error:            "access_denied",
				ErrorDescription: "the-desc",
				ErrorURI:         "https://p.example.com/help",
			},
		},
		{
			name:         "a missing cookie reads as an empty nonce",
			target:       api.IDPCallbackPath + "?state=proj-1.rand&code=the-code",
			wantStatus:   http.StatusSeeOther,
			wantLocation: returnTarget,
			wantIn:       service.FlowSSOCallbackInput{State: "proj-1.rand", Code: "the-code"},
		},
		{
			name:         "a cookie under the wrong name is not read",
			target:       api.IDPCallbackPath + "?state=proj-1.rand&code=the-code",
			cookie:       &http.Cookie{Name: "_zsso", Value: "the-nonce"},
			wantStatus:   http.StatusSeeOther,
			wantLocation: returnTarget,
			wantIn:       service.FlowSSOCallbackInput{State: "proj-1.rand", Code: "the-code"},
		},
		{
			name:       "an invalid state answers the uniform page",
			target:     api.IDPCallbackPath + "?state=unknown&code=the-code",
			err:        domain.ErrSSOStateInvalid(),
			wantStatus: http.StatusBadRequest,
			wantIn:     service.FlowSSOCallbackInput{State: "unknown", Code: "the-code"},
		},
		{
			name:       "an internal error answers the same page",
			target:     api.IDPCallbackPath + "?state=proj-1.rand&code=the-code",
			err:        domain.ErrInternal(nil),
			wantStatus: http.StatusInternalServerError,
			wantIn:     service.FlowSSOCallbackInput{State: "proj-1.rand", Code: "the-code"},
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
			api.NewIDPCallbackHandler(stub).ServeHTTP(rec, req)

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
	handler := api.WithRequestHostMiddleware(api.NewIDPCallbackHandler(stub))

	req := httptest.NewRequest(http.MethodGet, "http://localhost:8080"+api.IDPCallbackPath+"?state=proj-1.rand&code=the-code", nil)
	req.AddCookie(&http.Cookie{Name: "_zsso", Value: "the-nonce"})
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusSeeOther, rec.Code)
	assert.Equal(t, "the-nonce", stub.in.BindingNonce)
}

func TestIDPCallbackHandler_RefusesNonGET(t *testing.T) {
	t.Parallel()
	stub := &stubSSOCallback{}
	req := httptest.NewRequest(http.MethodPost, api.IDPCallbackPath, nil)
	rec := httptest.NewRecorder()
	api.NewIDPCallbackHandler(stub).ServeHTTP(rec, req)

	require.Equal(t, http.StatusMethodNotAllowed, rec.Code)
	assert.Equal(t, http.MethodGet, rec.Header().Get("Allow"))
	assert.Zero(t, stub.calls)
}