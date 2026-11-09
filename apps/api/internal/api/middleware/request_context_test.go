package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/api/middleware"
)

type mintedID struct{}

func (mintedID) New(prefix string) (string, error) { return prefix + "_minted", nil }

func TestRequestContextMiddlewareRequestID(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		idHeader string
		sent     []string
		want     string
	}{
		{name: "no header configured", sent: []string{"sfo1::fra1::2vxlh-1792820352212-3ce3eb4ad630"}, want: "req_minted"},
		{name: "Vercel's ID after its regions", idHeader: "x-vercel-id", sent: []string{"sfo1::fra1::2vxlh-1792820352212-3ce3eb4ad630"}, want: "2vxlh-1792820352212-3ce3eb4ad630"},
		{name: "an ID without hops", idHeader: "x-vercel-id", sent: []string{"2vxlh-1792820352212-3ce3eb4ad630"}, want: "2vxlh-1792820352212-3ce3eb4ad630"},
		{name: "the header missing", idHeader: "x-vercel-id", want: "req_minted"},
		{name: "nothing after the hops", idHeader: "x-vercel-id", sent: []string{"sfo1::fra1::"}, want: "req_minted"},
		{name: "text that is no ID", idHeader: "x-vercel-id", sent: []string{"<script>alert(1)</script>"}, want: "req_minted"},
		{name: "an ID too long to be one", idHeader: "x-vercel-id", sent: []string{strings.Repeat("a", 129)}, want: "req_minted"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			var gotContext, gotRequestContext string
			handler := middleware.WithRequestContextMiddleware(mintedID{}, tt.idHeader,
				http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
					gotContext, _ = middleware.GetRequestIDContext(r.Context())
					rc, ok := middleware.GetRequestContext(r.Context())
					require.True(t, ok)
					gotRequestContext = rc.RequestID
				}))
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			for _, value := range tt.sent {
				r.Header.Add("X-Vercel-Id", value)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, r)

			// One ID everywhere: logs read the context, events the request
			// context, clients the header.
			assert.Equal(t, tt.want, gotContext)
			assert.Equal(t, tt.want, gotRequestContext)
			assert.Equal(t, tt.want, rec.Header().Get("X-Request-Id"))
		})
	}
}
