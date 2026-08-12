package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCookieSecureFromContext(t *testing.T) {
	t.Parallel()

	t.Run("defaults to secure when host was never injected", func(t *testing.T) {
		t.Parallel()
		if !cookieSecureFromContext(context.Background()) {
			t.Fatal("expected Secure=true when request host is absent")
		}
	})

	t.Run("omits secure for http origins", func(t *testing.T) {
		t.Parallel()
		ctx := context.WithValue(context.Background(), requestHostKey{}, "http://localhost:3000")
		if cookieSecureFromContext(ctx) {
			t.Fatal("expected Secure=false for http://localhost")
		}
	})

	t.Run("keeps secure for https origins", func(t *testing.T) {
		t.Parallel()
		ctx := context.WithValue(context.Background(), requestHostKey{}, "https://app.example.com")
		if !cookieSecureFromContext(ctx) {
			t.Fatal("expected Secure=true for https origins")
		}
	})
}

func TestFlowSetCookie_SecureFollowsScheme(t *testing.T) {
	t.Parallel()

	httpCtx := context.WithValue(context.Background(), requestHostKey{}, "http://localhost:3000")
	httpsCtx := context.WithValue(context.Background(), requestHostKey{}, "https://app.example.com")

	httpCookie := flowSetCookie(httpCtx, "payload", false)
	if strings.Contains(httpCookie, "Secure") {
		t.Fatalf("http cookie must omit Secure for Safari on localhost, got %q", httpCookie)
	}
	if !strings.Contains(httpCookie, "HttpOnly") || !strings.Contains(httpCookie, "SameSite=Strict") {
		t.Fatalf("http cookie missing expected attrs: %q", httpCookie)
	}

	httpsCookie := flowSetCookie(httpsCtx, "payload", false)
	if !strings.Contains(httpsCookie, "Secure") {
		t.Fatalf("https cookie must include Secure, got %q", httpsCookie)
	}
}

func TestSessionCookie_SecureFollowsScheme(t *testing.T) {
	t.Parallel()

	httpCtx := context.WithValue(context.Background(), requestHostKey{}, "http://localhost:3000")
	httpsCtx := context.WithValue(context.Background(), requestHostKey{}, "https://app.example.com")

	httpCookie := sessionCookie(httpCtx, "tok", 60)
	if strings.Contains(httpCookie, "Secure") {
		t.Fatalf("http session cookie must omit Secure, got %q", httpCookie)
	}

	httpsCookie := sessionCookie(httpsCtx, "tok", 60)
	if !strings.Contains(httpsCookie, "Secure") {
		t.Fatalf("https session cookie must include Secure, got %q", httpsCookie)
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

	t.Run("plain http", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "http://localhost:8080/flow", nil)
		req.Host = "localhost:8080"
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if sawSecure {
			t.Fatal("expected Secure=false for plain HTTP request")
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
