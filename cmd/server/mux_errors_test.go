package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/metric/noop"

	oasapi "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/storage/dialect/idgen"
)

// A path nothing serves, through the server's own chain: a browser gets the
// error page and a program the envelope, and with request_id_header set both
// quote the ID the proxy in front gave the request, as on the hosted cloud
// (ADR 076).
func TestBuildHTTPMuxAnswersAPathNothingServes(t *testing.T) {
	apiServer, err := oasapi.NewServer(oasapi.UnimplementedHandler{}, api.NewSecurityHandler(nil),
		apiServerOptions(muxTracerProvider, noop.NewMeterProvider(), consoleLink("/console"))...)
	require.NoError(t, err)
	mux, err := buildHTTPMux(ServerConfig{RequestIDHeader: "x-vercel-id"}, idgen.NewULID(), apiServer, idpCallbackEcho(), nil, nil, nil)
	require.NoError(t, err)

	const vercelRequestID = "2vxlh-1792820352212-3ce3eb4ad630"
	send := func(accept string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "/no-such-page", nil)
		r.Header.Set("Accept", accept)
		r.Header.Set("X-Vercel-Id", "sfo1::fra1::"+vercelRequestID)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, r)
		return rec
	}

	page := send("text/html,application/xhtml+xml,*/*;q=0.8")
	assert.Equal(t, http.StatusNotFound, page.Code)
	assert.Equal(t, vercelRequestID, page.Header().Get("X-Request-Id"))
	assert.Contains(t, page.Body.String(), "Request ID <code>"+vercelRequestID+"</code>")
	assert.Contains(t, page.Body.String(), `<a class="error-action" href="/console/">Open the console</a>`)

	envelope := send("*/*")
	assert.Equal(t, http.StatusNotFound, envelope.Code)
	assert.Equal(t, vercelRequestID, envelope.Header().Get("X-Request-Id"))
	assert.JSONEq(t, `{"code":"req.not_found","message":"No API operation matches this path."}`, envelope.Body.String())
}
