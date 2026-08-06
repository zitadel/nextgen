package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/middleware"
)

func TestChain_AppliesFirstListedOutermost(t *testing.T) {
	var order []string
	record := func(name string) func(http.Handler) http.Handler {
		return func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				order = append(order, name)
				next.ServeHTTP(w, r)
			})
		}
	}
	final := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		order = append(order, "handler")
	})

	middleware.Chain(final, record("a"), record("b"), record("c")).
		ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))

	require.Equal(t, []string{"a", "b", "c", "handler"}, order)
}

func TestChain_NoMiddlewaresReturnsHandler(t *testing.T) {
	final := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})
	require.NotNil(t, middleware.Chain(final))
}
