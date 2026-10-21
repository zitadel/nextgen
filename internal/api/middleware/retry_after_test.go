package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/middleware"
)

func TestWithRetryAfter(t *testing.T) {
	t.Parallel()

	serve := func(handler http.HandlerFunc) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		middleware.WithRetryAfter(handler).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/", nil))
		return rec
	}

	t.Run("a 429 without the header gets one", func(t *testing.T) {
		t.Parallel()
		rec := serve(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusTooManyRequests)
		})
		require.Equal(t, http.StatusTooManyRequests, rec.Code)
		require.Equal(t, "1", rec.Header().Get("Retry-After"))
	})

	t.Run("a handler's own Retry-After is kept", func(t *testing.T) {
		t.Parallel()
		rec := serve(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Retry-After", "30")
			w.WriteHeader(http.StatusTooManyRequests)
		})
		require.Equal(t, "30", rec.Header().Get("Retry-After"))
	})

	t.Run("other statuses are left alone", func(t *testing.T) {
		t.Parallel()
		rec := serve(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusServiceUnavailable)
		})
		require.Empty(t, rec.Header().Get("Retry-After"))

		rec = serve(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte("ok"))
		})
		require.Equal(t, http.StatusOK, rec.Code)
		require.Empty(t, rec.Header().Get("Retry-After"))
	})

	t.Run("the writer underneath stays reachable", func(t *testing.T) {
		t.Parallel()
		var flushed bool
		serve(func(w http.ResponseWriter, _ *http.Request) {
			flushed = http.NewResponseController(w).Flush() == nil
		})
		require.True(t, flushed)
	})

	t.Run("a direct Flusher assertion reaches the writer underneath", func(t *testing.T) {
		t.Parallel()
		rec := serve(func(w http.ResponseWriter, _ *http.Request) {
			f, ok := w.(http.Flusher)
			require.True(t, ok)
			_, _ = w.Write([]byte("partial"))
			f.Flush()
		})
		require.True(t, rec.Flushed)
	})
}
