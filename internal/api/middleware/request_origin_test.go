package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/middleware"
)

func TestRequestOrigin(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		headers map[string]string
		want    string
	}{
		{name: "origin header, lower-cased", headers: map[string]string{"Origin": "HTTPS://App.Example.com"}, want: "https://app.example.com"},
		{name: "origin wins over referer", headers: map[string]string{"Origin": "https://a.example", "Referer": "https://b.example/x"}, want: "https://a.example"},
		{name: "referer origin only", headers: map[string]string{"Referer": "https://app.example.com/login?next=/"}, want: "https://app.example.com"},
		{name: "opaque origin null falls back to referer", headers: map[string]string{"Origin": "null", "Referer": "http://localhost:3000/"}, want: "http://localhost:3000"},
		{name: "unparsable referer", headers: map[string]string{"Referer": "not a url"}, want: ""},
		{name: "no headers", headers: nil, want: ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			r := httptest.NewRequest(http.MethodPost, "/flow", nil)
			for name, value := range tc.headers {
				r.Header.Set(name, value)
			}
			require.Equal(t, tc.want, middleware.RequestOrigin(r))
		})
	}
}
