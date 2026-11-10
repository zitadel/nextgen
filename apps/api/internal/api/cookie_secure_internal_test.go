package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCookieSecureFromContext(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name   string
		origin string // empty means no host injected
		secure bool
	}{
		{name: "defaults to secure when host was never injected", secure: true},
		{name: "omits secure for http localhost", origin: "http://localhost:3000", secure: false},
		{name: "omits secure for http 127.0.0.1", origin: "http://127.0.0.1:3000", secure: false},
		{name: "omits secure for http ipv6 loopback", origin: "http://[::1]:3000", secure: false},
		{name: "keeps secure for https origins", origin: "https://app.example.com", secure: true},
		{name: "keeps secure for non-loopback http", origin: "http://app.example.com", secure: true},
		{name: "keeps secure on unparseable origin", origin: "://bad", secure: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			ctx := context.Background()
			if tc.origin != "" {
				ctx = context.WithValue(ctx, requestHostKey{}, tc.origin)
			}
			if got := cookieSecureFromContext(ctx); got != tc.secure {
				t.Fatalf("cookieSecureFromContext(%q) = %v, want %v", tc.origin, got, tc.secure)
			}
		})
	}
}

func TestIsLoopbackHost(t *testing.T) {
	t.Parallel()

	cases := []struct {
		host string
		want bool
	}{
		{host: "localhost", want: true},
		{host: "LOCALHOST", want: true},
		{host: "127.0.0.1", want: true},
		{host: "127.0.0.42", want: true},
		{host: "::1", want: true},
		{host: "app.example.com", want: false},
		{host: "192.168.1.1", want: false},
		{host: "", want: false},
	}
	for _, tc := range cases {
		t.Run(tc.host, func(t *testing.T) {
			t.Parallel()
			if got := isLoopbackHost(tc.host); got != tc.want {
				t.Fatalf("isLoopbackHost(%q) = %v, want %v", tc.host, got, tc.want)
			}
		})
	}
}

func TestFlowSetCookie_SecureFollowsScheme(t *testing.T) {
	t.Parallel()

	httpCtx := context.WithValue(context.Background(), requestHostKey{}, "http://localhost:3000")
	httpsCtx := context.WithValue(context.Background(), requestHostKey{}, "https://app.example.com")

	httpCookie, err := http.ParseSetCookie(flowSetCookie(httpCtx, "payload", false))
	if err != nil {
		t.Fatalf("parse http cookie: %v", err)
	}
	if httpCookie.Secure {
		t.Fatalf("http cookie must omit Secure for Safari on localhost, got %+v", httpCookie)
	}
	if !httpCookie.HttpOnly || httpCookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("http cookie missing expected attrs: %+v", httpCookie)
	}

	httpsCookie, err := http.ParseSetCookie(flowSetCookie(httpsCtx, "payload", false))
	if err != nil {
		t.Fatalf("parse https cookie: %v", err)
	}
	if !httpsCookie.Secure {
		t.Fatalf("https cookie must include Secure, got %+v", httpsCookie)
	}
}

// The session cookie is __Host-zitadel_session wherever it is Secure, and
// zitadel_session over plain http to a loopback host (ADR 083); set and
// cleared alike, with the attributes the prefix requires.
func TestSessionCookie_NameAndSecureFollowScheme(t *testing.T) {
	t.Parallel()

	cases := []struct {
		origin string
		name   string
		secure bool
	}{
		{origin: "http://localhost:3000", name: "zitadel_session", secure: false},
		{origin: "http://127.0.0.1:8080", name: "zitadel_session", secure: false},
		{origin: "https://app.example.com", name: "__Host-zitadel_session", secure: true},
		{origin: "https://localhost:8443", name: "__Host-zitadel_session", secure: true},
		{origin: "http://app.example.com", name: "__Host-zitadel_session", secure: true},
	}
	for _, tc := range cases {
		t.Run(tc.origin, func(t *testing.T) {
			t.Parallel()
			ctx := context.WithValue(context.Background(), requestHostKey{}, tc.origin)
			for kind, setCookie := range map[string]string{
				"set":     sessionCookie(ctx, "tok", 60),
				"cleared": deleteSessionCookie(ctx),
			} {
				cookie, err := http.ParseSetCookie(setCookie)
				require.NoError(t, err, kind)
				assert.Equal(t, tc.name, cookie.Name, kind)
				assert.Equal(t, tc.secure, cookie.Secure, kind)
				assert.Equal(t, "/", cookie.Path, kind)
				assert.Empty(t, cookie.Domain, kind)
				assert.True(t, cookie.HttpOnly, kind)
				assert.Equal(t, http.SameSiteLaxMode, cookie.SameSite, kind)
			}
		})
	}
}

// The generated reader reads only the canonical name. Over plain http to a
// loopback host the browser holds zitadel_session, which the middleware hands
// it under that name; everywhere else, and for the old names everywhere, the
// reader finds no session.
func TestWithLoopbackSessionCookie(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name    string
		url     string
		proto   string
		cookies string
		want    string // what the generated reader finds; empty for nothing
	}{
		{
			name:    "loopback http hands the loopback name over",
			url:     "http://localhost:8080/sessions/me",
			cookies: "zitadel_session=loopback",
			want:    "loopback",
		},
		{
			name:    "loopback ip hands the loopback name over",
			url:     "http://127.0.0.1:8080/sessions/me",
			cookies: "other=1; zitadel_session=loopback",
			want:    "loopback",
		},
		{
			name:    "the canonical name wins on loopback http",
			url:     "http://localhost:8080/sessions/me",
			cookies: "zitadel_session=loopback; __Host-zitadel_session=canonical",
			want:    "canonical",
		},
		{
			name:    "the canonical name is read on loopback http",
			url:     "http://localhost:8080/sessions/me",
			cookies: "__Host-zitadel_session=canonical",
			want:    "canonical",
		},
		{
			name:    "https ignores the loopback name",
			url:     "https://app.example.com/sessions/me",
			cookies: "zitadel_session=planted",
		},
		{
			name:    "forwarded https ignores the loopback name",
			url:     "http://localhost:8080/sessions/me",
			proto:   "https",
			cookies: "zitadel_session=planted",
		},
		{
			name:    "non-loopback http ignores the loopback name",
			url:     "http://app.example.com/sessions/me",
			cookies: "zitadel_session=planted",
		},
		{
			name:    "the old name is ignored on loopback http",
			url:     "http://localhost:8080/sessions/me",
			cookies: "__nextgen_session=old",
		},
		{
			name:    "the old name is ignored on https",
			url:     "https://app.example.com/sessions/me",
			cookies: "__nextgen_session=old; __nextgen_session_proj_1=old",
		},
		{
			name:    "the old name before the canonical one is ignored",
			url:     "https://app.example.com/sessions/me",
			cookies: "__nextgen_session=old; __Host-zitadel_session=canonical",
			want:    "canonical",
		},
		{
			name:    "the old name before the loopback one is ignored",
			url:     "http://localhost:8080/sessions/me",
			cookies: "__nextgen_session=old; zitadel_session=loopback",
			want:    "loopback",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var found string
			handler := WithRequestHostMiddleware(WithLoopbackSessionCookie(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				if cookie, err := r.Cookie(sessionCookieName); err == nil {
					found = cookie.Value
				}
			})))
			req := httptest.NewRequest(http.MethodGet, tc.url, nil)
			if tc.proto != "" {
				req.Header.Set("X-Forwarded-Proto", tc.proto)
			}
			req.Header.Set("Cookie", tc.cookies)

			handler.ServeHTTP(httptest.NewRecorder(), req)

			assert.Equal(t, tc.want, found)
			assert.Equal(t, tc.cookies, req.Header.Get("Cookie"), "the caller's request keeps its header")
		})
	}
}

// A request with its cookies on several lines keeps every one of them.
func TestWithLoopbackSessionCookie_KeepsEveryCookieLine(t *testing.T) {
	t.Parallel()

	var cookies []string
	handler := WithRequestHostMiddleware(WithLoopbackSessionCookie(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		for _, cookie := range r.Cookies() {
			cookies = append(cookies, cookie.Name+"="+cookie.Value)
		}
	})))
	req := httptest.NewRequest(http.MethodGet, "http://localhost:8080/sessions/me", nil)
	req.Header.Add("Cookie", "a=1")
	req.Header.Add("Cookie", "zitadel_session=loopback; b=2")

	handler.ServeHTTP(httptest.NewRecorder(), req)

	assert.Equal(t, []string{"a=1", "zitadel_session=loopback", "b=2", "__Host-zitadel_session=loopback"}, cookies)
}

func TestWithRequestHostMiddleware_DrivesCookieSecure(t *testing.T) {
	t.Parallel()

	var sawSecure bool
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawSecure = cookieSecureFromContext(r.Context())
		w.WriteHeader(http.StatusNoContent)
	})
	handler := WithRequestHostMiddleware(inner)

	t.Run("plain http localhost", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "http://localhost:8080/flow", nil)
		req.Host = "localhost:8080"
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if sawSecure {
			t.Fatal("expected Secure=false for plain HTTP localhost")
		}
	})

	t.Run("plain http non-loopback keeps secure", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "http://app.example.com/flow", nil)
		req.Host = "app.example.com"
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if !sawSecure {
			t.Fatal("expected Secure=true for non-loopback HTTP")
		}
	})

	t.Run("forwarded https", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "http://localhost:8080/flow", nil)
		req.Host = "localhost:8080"
		req.Header.Set("X-Forwarded-Proto", "https")
		req.Header.Set("X-Forwarded-Host", "app.example.com")
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if !sawSecure {
			t.Fatal("expected Secure=true when X-Forwarded-Proto is https")
		}
	})
}

// The generated client splits the first Set-Cookie line on commas, so no
// cookie this package builds may contain one: Max-Age, never Expires, and
// values that are base64url or a nonce.
// A chain of proxies may append to either forwarded header; the first entry is
// what the client's request arrived with.
func TestWithRequestHostMiddleware_ForwardedLists(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "http://backend:8080/flow", nil)
	req.Header.Set("X-Forwarded-Proto", "https, http")
	req.Header.Set("X-Forwarded-Host", "app.example.com, lb.internal")

	var got string
	WithRequestHostMiddleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		got, _ = requestOriginFromContext(r.Context())
	})).ServeHTTP(httptest.NewRecorder(), req)

	assert.Equal(t, "https://app.example.com", got)
}

func TestCookies_HaveNoComma(t *testing.T) {
	t.Parallel()

	ctx := context.WithValue(context.Background(), requestHostKey{}, "https://app.example.com")
	for name, cookie := range map[string]string{
		"flow":          flowSetCookie(ctx, "payload", false),
		"flow cleared":  flowSetCookie(ctx, "", true),
		"sso binding":   ssoBindingSetCookie(ctx, "nonce"),
		"session":       sessionCookie(ctx, "tok", 60),
		"session clear": deleteSessionCookie(ctx),
	} {
		assert.NotContains(t, cookie, ",", "%s cookie", name)
	}
}
