package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestWithCSRFRequest(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name       string
		method     string
		header     http.Header
		wantUnsafe bool
		wantOrigin bool
	}{
		{"GET is safe", http.MethodGet, nil, false, false},
		{"HEAD is safe", http.MethodHead, nil, false, false},
		{"OPTIONS is safe", http.MethodOptions, nil, false, false},
		{"same-origin POST", http.MethodPost, http.Header{"Sec-Fetch-Site": {"same-origin"}}, true, false},
		{"cross-site DELETE", http.MethodDelete, http.Header{"Sec-Fetch-Site": {"cross-site"}}, true, true},
		{"TRACE is unsafe", http.MethodTrace, nil, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			req := httptest.NewRequest(tc.method, "/teams", nil)
			for k, v := range tc.header {
				req.Header[k] = v
			}
			req.Header.Set(CSRFHeader, "the-token")

			var got csrfRequest
			WithCSRFRequest(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				var ok bool
				got, ok = r.Context().Value(csrfRequestKey{}).(csrfRequest)
				require.True(t, ok)
			})).ServeHTTP(httptest.NewRecorder(), req)

			assert.Equal(t, tc.wantUnsafe, got.unsafe)
			assert.Equal(t, tc.wantOrigin, got.originErr != nil)
			assert.Equal(t, "the-token", got.token)
		})
	}
}

// A proxy that rewrites Host (nginx's default) must not turn a client's real
// Origin into a cross-origin refusal: the guard's Origin fallback compares
// against the effective host WithRequestHostMiddleware resolved, as the server
// chains them.
func TestWithCSRFRequestUsesEffectiveHost(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name          string
		origin        string
		forwardedHost string
		wantOrigin    bool
	}{
		{"origin matches the forwarded host", "https://console.example.com", "console.example.com", false},
		{"origin matches neither", "https://evil.example", "console.example.com", true},
		{"no forwarded host: compared with Host", "https://console.example.com", "", true},
		{"no forwarded host, origin matches Host", "http://backend:8080", "", false},
		// Proxies append: the first entry is the host the client asked for.
		{"forwarded host list", "https://console.example.com", "console.example.com, lb.internal", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			// No Sec-Fetch-Site: a non-browser client, like the CLI.
			req := httptest.NewRequest(http.MethodPost, "http://backend:8080/teams", nil)
			req.Header.Set("Origin", tc.origin)
			if tc.forwardedHost != "" {
				req.Header.Set("X-Forwarded-Host", tc.forwardedHost)
			}

			var got csrfRequest
			WithRequestHostMiddleware(WithCSRFRequest(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				got, _ = r.Context().Value(csrfRequestKey{}).(csrfRequest)
			}))).ServeHTTP(httptest.NewRecorder(), req)

			require.True(t, got.unsafe)
			assert.Equal(t, tc.wantOrigin, got.originErr != nil, "%v", got.originErr)
		})
	}
}

func TestCheckSessionCSRF(t *testing.T) {
	t.Parallel()

	const cookie = "the-session-cookie"
	unsafe := func(token string) context.Context {
		return context.WithValue(context.Background(), csrfRequestKey{}, csrfRequest{unsafe: true, token: token})
	}

	for _, tc := range []struct {
		name string
		ctx  context.Context
		op   api.OperationName
		want error
	}{
		{"safe request passes", context.WithValue(context.Background(), csrfRequestKey{}, csrfRequest{}), api.CreateTeamOperation, nil},
		{"cross-origin is refused even when exempt",
			context.WithValue(context.Background(), csrfRequestKey{}, csrfRequest{unsafe: true, originErr: errors.New("cross-origin")}),
			api.RevokeMySessionOperation, domain.ErrAuthCSRFInvalid()},
		{"exempt logout needs no token", unsafe(""), api.RevokeMySessionOperation, nil},
		{"exempt query read needs no token", unsafe(""), api.QueryUsersOperation, nil},
		{"write without token is refused", unsafe(""), api.CreateTeamOperation, domain.ErrAuthCSRFInvalid()},
		{"write with another session's token is refused", unsafe(CSRFToken("other-cookie")), api.CreateTeamOperation, domain.ErrAuthCSRFInvalid()},
		{"write with the session's token passes", unsafe(CSRFToken(cookie)), api.CreateTeamOperation, nil},
		// Deny by default: an operation that was never listed anywhere still
		// needs the token once the cookie authenticates a write to it.
		{"unlisted write without token is refused", unsafe(""), api.CreateBrandingOperation, domain.ErrAuthCSRFInvalid()},
		{"missing middleware state fails closed", context.Background(), api.GetMySessionOperation, domain.ErrInternal(nil)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			err := checkSessionCSRF(tc.ctx, tc.op, cookie)
			if tc.want == nil {
				require.NoError(t, err)
				return
			}
			require.ErrorIs(t, err, tc.want)
		})
	}
}

// The api-mock derives the same token (packages/api-mock/src/server.ts
// csrfTokenFor); this vector is pinned on both sides so the two cannot drift.
func TestCSRFTokenVector(t *testing.T) {
	t.Parallel()
	assert.Equal(t, "Rstk677ADwP3NGbLdczBjYCLA5EIxtRtrm-oX7QcYh8", CSRFToken("parity-cookie"))
}
