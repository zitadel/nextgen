package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
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

func TestSessionCookie_SecureFollowsScheme(t *testing.T) {
	t.Parallel()

	httpCtx := context.WithValue(context.Background(), requestHostKey{}, "http://localhost:3000")
	httpsCtx := context.WithValue(context.Background(), requestHostKey{}, "https://app.example.com")

	httpCookie, err := http.ParseSetCookie(sessionCookie(httpCtx, "tok", 60))
	if err != nil {
		t.Fatalf("parse http session cookie: %v", err)
	}
	if httpCookie.Secure {
		t.Fatalf("http session cookie must omit Secure, got %+v", httpCookie)
	}

	httpsCookie, err := http.ParseSetCookie(sessionCookie(httpsCtx, "tok", 60))
	if err != nil {
		t.Fatalf("parse https session cookie: %v", err)
	}
	if !httpsCookie.Secure {
		t.Fatalf("https session cookie must include Secure, got %+v", httpsCookie)
	}
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
