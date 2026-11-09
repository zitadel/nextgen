package httputil_test

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/httputil"
)

func TestForwardedOrigin(t *testing.T) {
	t.Parallel()

	for _, tt := range []struct {
		name  string
		host  string
		tls   bool
		proto string
		fwd   string
		want  string
	}{
		{name: "plain request host", host: "api.example.com", want: "http://api.example.com"},
		{name: "tls request host", host: "api.example.com", tls: true, want: "https://api.example.com"},
		{name: "forwarded host and proto", host: "api.internal", proto: "https", fwd: "app.example.com", want: "https://app.example.com"},
		{name: "forwarded proto only", host: "api.example.com", proto: "https", want: "https://api.example.com"},
		{name: "forwarded host keeps the port", host: "api.internal", fwd: "localhost:3000", want: "http://localhost:3000"},
		{name: "first entry of a proxy chain", host: "api.internal", proto: "https, http", fwd: "app.example.com, api.internal", want: "https://app.example.com"},
		{name: "forwarded proto wins over tls", host: "api.internal", tls: true, proto: "http", want: "http://api.internal"},
		{name: "no host", want: ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			r.Host = tt.host
			if tt.tls {
				r.TLS = new(tls.ConnectionState)
			}
			if tt.proto != "" {
				r.Header.Set("X-Forwarded-Proto", tt.proto)
			}
			if tt.fwd != "" {
				r.Header.Set("X-Forwarded-Host", tt.fwd)
			}
			assert.Equal(t, tt.want, httputil.ForwardedOrigin(r))
		})
	}
}
