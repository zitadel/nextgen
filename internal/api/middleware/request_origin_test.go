package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/middleware"
)

func TestWithRequestOriginMiddleware(t *testing.T) {
	t.Parallel()

	capture := func(headers map[string]string) (string, bool) {
		r := httptest.NewRequest(http.MethodPost, "/flow", nil)
		for name, value := range headers {
			r.Header.Set(name, value)
		}
		var (
			origin string
			ok     bool
		)
		middleware.WithRequestOriginMiddleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			origin, ok = middleware.RequestOriginFromContext(r.Context())
		})).ServeHTTP(httptest.NewRecorder(), r)
		return origin, ok
	}

	tests := []struct {
		name    string
		headers map[string]string
		want    string
		wantOK  bool
	}{
		{name: "origin header, lower-cased", headers: map[string]string{"Origin": "HTTPS://App.Example.com"}, want: "https://app.example.com", wantOK: true},
		{name: "origin wins over referer", headers: map[string]string{"Origin": "https://a.example", "Referer": "https://b.example/x"}, want: "https://a.example", wantOK: true},
		{name: "referer origin only", headers: map[string]string{"Referer": "https://app.example.com/login?next=/"}, want: "https://app.example.com", wantOK: true},
		{name: "opaque origin null falls back to referer", headers: map[string]string{"Origin": "null", "Referer": "http://localhost:3000/"}, want: "http://localhost:3000", wantOK: true},
		{name: "unparsable referer", headers: map[string]string{"Referer": "not a url"}, want: "", wantOK: false},
		{name: "no headers", headers: nil, want: "", wantOK: false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			origin, ok := capture(tc.headers)
			require.Equal(t, tc.wantOK, ok)
			require.Equal(t, tc.want, origin)
		})
	}
}
