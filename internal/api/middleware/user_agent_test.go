package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestWithUserAgentMiddleware(t *testing.T) {
	t.Parallel()

	capture := func(r *http.Request) (*domain.UserAgent, bool) {
		var (
			ua *domain.UserAgent
			ok bool
		)
		middleware.WithUserAgentMiddleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			ua, ok = middleware.UserAgentFromContext(r.Context())
		})).ServeHTTP(httptest.NewRecorder(), r)
		return ua, ok
	}

	t.Run("x-forwarded-for first hop and user-agent header", func(t *testing.T) {
		t.Parallel()
		r := httptest.NewRequest(http.MethodPost, "/", nil)
		r.Header.Set("X-Forwarded-For", "203.0.113.9, 10.0.0.1")
		r.Header.Set("User-Agent", "Mozilla/5.0 (test)")

		ua, ok := capture(r)
		require.True(t, ok)
		require.Equal(t, "203.0.113.9", ua.IP)
		require.Equal(t, "Mozilla/5.0 (test)", ua.Info["user_agent"])
	})

	t.Run("falls back to RemoteAddr without its port", func(t *testing.T) {
		t.Parallel()
		r := httptest.NewRequest(http.MethodPost, "/", nil)
		r.RemoteAddr = "198.51.100.7:54321"

		ua, ok := capture(r)
		require.True(t, ok)
		require.Equal(t, "198.51.100.7", ua.IP)
	})

	t.Run("ignores a non-ip x-forwarded-for and falls back to RemoteAddr", func(t *testing.T) {
		t.Parallel()
		r := httptest.NewRequest(http.MethodPost, "/", nil)
		r.Header.Set("X-Forwarded-For", "not-an-ip")
		r.RemoteAddr = "198.51.100.7:54321"

		ua, ok := capture(r)
		require.True(t, ok)
		require.Equal(t, "198.51.100.7", ua.IP)
	})

	t.Run("absent when neither ip nor user-agent is present", func(t *testing.T) {
		t.Parallel()
		r := httptest.NewRequest(http.MethodPost, "/", nil)
		r.RemoteAddr = ""
		r.Header.Del("User-Agent")

		_, ok := capture(r)
		require.False(t, ok)
	})
}
