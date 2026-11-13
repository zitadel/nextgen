package api_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	"github.com/zitadel/nextgen/internal/api"
	gen "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/api/middleware"
)

// A request no operation answers starts its own server span, as ogen does
// for an operation, and stores it in the holder the request line reads its
// IDs from. The span is named after the method and has no route: the path is
// the caller's text, and so is a method the conventions do not list.
func TestARequestNoOperationAnswersStartsAServerSpan(t *testing.T) {
	t.Parallel()
	srv, err := gen.NewServer(gen.UnimplementedHandler{}, api.NewSecurityHandler(nil),
		gen.WithNotFound(api.OgenNotFound(nil)),
		gen.WithMethodNotAllowed(api.OgenMethodNotAllowed),
	)
	require.NoError(t, err)

	for _, tt := range []struct {
		name       string
		method     string
		path       string
		wantStatus int
		wantName   string
		wantMethod string
	}{
		{name: "a path the API lacks", method: http.MethodGet, path: "/users/alice@example.com/no-such-page", wantStatus: http.StatusNotFound, wantName: "GET", wantMethod: "GET"},
		{name: "a method the path does not take", method: http.MethodDelete, path: "/livez", wantStatus: http.StatusMethodNotAllowed, wantName: "DELETE", wantMethod: "DELETE"},
		{name: "a CORS preflight", method: http.MethodOptions, path: "/livez", wantStatus: http.StatusNoContent, wantName: "OPTIONS", wantMethod: "OPTIONS"},
		{name: "a method of the caller's own", method: "ALICE", path: "/no-such-page", wantStatus: http.StatusNotFound, wantName: "HTTP", wantMethod: "_OTHER"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ctx := middleware.WithOperationIDContext(t.Context(), "")
			rec := httptest.NewRecorder()
			srv.ServeHTTP(rec, httptest.NewRequestWithContext(ctx, tt.method, tt.path, nil))
			require.Equal(t, tt.wantStatus, rec.Code)

			server := middleware.GetServerSpanContext(ctx)
			require.True(t, server.IsSampled(), "the sampler takes a Server root")
			// Other tests in this package serve requests in parallel, so only
			// the spans of this request's trace are looked at.
			var spans []tracetest.SpanStub
			for _, s := range spanExporter.GetSpans() {
				if s.SpanContext.TraceID() == server.TraceID() {
					spans = append(spans, s)
				}
			}
			require.Len(t, spans, 1)
			assert.Equal(t, server, spans[0].SpanContext)
			assert.Equal(t, trace.SpanKindServer, spans[0].SpanKind)
			assert.Equal(t, tt.wantName, spans[0].Name)
			assert.Equal(t, []attribute.KeyValue{
				attribute.String("http.request.method", tt.wantMethod),
				attribute.Int("http.response.status_code", tt.wantStatus),
			}, spans[0].Attributes)
		})
	}
}
