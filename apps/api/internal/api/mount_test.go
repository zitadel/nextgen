package api

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	openapibundled "github.com/zitadel/nextgen/api/openapi/bundled"
	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/instrumentation/zotel"
)

// probeHandler answers the probes and no other operation, so a response
// tells how far a request got: 200 from a probe, 401 from an operation that
// needs the credential the request does not send, the envelope's 404 and 405
// from the router.
type probeHandler struct{ api.UnimplementedHandler }

func (probeHandler) GetLive(context.Context) (api.GetLiveRes, error) {
	return &api.GetLiveOK{Data: strings.NewReader("ok")}, nil
}

func (probeHandler) GetReady(context.Context) (api.GetReadyRes, error) {
	return &api.GetReadyOK{Data: strings.NewReader("ok")}, nil
}

type mountedAPI struct {
	mux     *http.ServeMux
	spans   *tracetest.InMemoryExporter
	metrics *sdkmetric.ManualReader
}

func newMountedAPI(t *testing.T) mountedAPI {
	t.Helper()
	spans := tracetest.NewInMemoryExporter()
	metrics := sdkmetric.NewManualReader()
	servers, err := NewServers(probeHandler{}, NewSecurityHandler(nil),
		api.WithErrorHandler(OgenErrorHandler(0)),
		api.WithNotFound(OgenNotFound(nil)),
		api.WithMethodNotAllowed(OgenMethodNotAllowed),
		api.WithTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSyncer(spans))),
		api.WithMeterProvider(sdkmetric.NewMeterProvider(sdkmetric.WithReader(metrics), sdkmetric.WithView(zotel.MeterViews()...))),
	)
	require.NoError(t, err)
	mux := http.NewServeMux()
	identity := func(h http.Handler) http.Handler { return h }
	MountAPI(mux, identity, identity, servers)
	return mountedAPI{mux: mux, spans: spans, metrics: metrics}
}

func (m mountedAPI) serve(r *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	m.mux.ServeHTTP(rec, r)
	return rec
}

// The API answers under its prefix and, until 1.0.0, at the root, where a
// response for an operation says it is deprecated (ADR 077 §4). The probes
// answer at the root for good and never say so, and neither does an answer
// for a path or a method no operation takes.
func TestMountAPIServesThePrefixAndTheRootAlias(t *testing.T) {
	t.Parallel()
	m := newMountedAPI(t)

	for _, tt := range []struct {
		method, path string
		status       int
		code         string // the envelope's, when the router answers
		deprecated   bool
	}{
		{method: http.MethodGet, path: "/api/v1/users/me", status: http.StatusUnauthorized},
		{method: http.MethodPatch, path: "/api/v1/users/me", status: http.StatusUnauthorized},
		{method: http.MethodGet, path: "/users/me", status: http.StatusUnauthorized, deprecated: true},
		{method: http.MethodPatch, path: "/users/me", status: http.StatusUnauthorized, deprecated: true},

		{method: http.MethodGet, path: "/livez", status: http.StatusOK},
		{method: http.MethodGet, path: "/readyz", status: http.StatusOK},
		{method: http.MethodGet, path: "/api/v1/livez", status: http.StatusOK},
		{method: http.MethodGet, path: "/api/v1/readyz", status: http.StatusOK},

		// The bare prefix is the API's: its 404, not the mux's redirect.
		{method: http.MethodGet, path: "/api/v1", status: http.StatusNotFound, code: "req.not_found"},
		{method: http.MethodGet, path: "/api/v1/", status: http.StatusNotFound, code: "req.not_found"},
		{method: http.MethodGet, path: "/api/v1/nope", status: http.StatusNotFound, code: "req.not_found"},
		{method: http.MethodGet, path: "/api/v1x/users/me", status: http.StatusNotFound, code: "req.not_found"},
		{method: http.MethodGet, path: "/nope", status: http.StatusNotFound, code: "req.not_found"},
		{method: http.MethodGet, path: "/livez/", status: http.StatusNotFound, code: "req.not_found"},

		{method: http.MethodPost, path: "/livez", status: http.StatusMethodNotAllowed, code: "req.method_not_allowed"},
		{method: http.MethodPost, path: "/api/v1/sessions/me/csrf", status: http.StatusMethodNotAllowed, code: "req.method_not_allowed"},
		{method: http.MethodPost, path: "/sessions/me/csrf", status: http.StatusMethodNotAllowed, code: "req.method_not_allowed"},
	} {
		rec := m.serve(httptest.NewRequest(tt.method, tt.path, nil))
		name := tt.method + " " + tt.path
		assert.Equal(t, tt.status, rec.Code, name)
		if tt.code != "" {
			var envelope struct{ Code string }
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope), name)
			assert.Equal(t, tt.code, envelope.Code, name)
		}
		if tt.deprecated {
			assert.Equal(t, rootPathDeprecation, rec.Header().Get("Deprecation"), name)
			assert.Equal(t, []string{rootPathDeprecationLink}, rec.Header().Values("Link"), name)
		} else {
			assert.Empty(t, rec.Header().Get("Deprecation"), name)
			assert.Empty(t, rec.Header().Values("Link"), name)
		}
	}
}

// The OpenAPI document this binary embeds is a MountAPI mount outside the
// ogen/auth chain, so a client can read the contract that deployment speaks
// without auth. OPTIONS answers CORS preflight; a matching If-None-Match is 304.
func TestMountAPIServesTheOpenAPIDocument(t *testing.T) {
	t.Parallel()
	m := newMountedAPI(t)

	rec := m.serve(httptest.NewRequest(http.MethodGet, openapibundled.Path, nil))
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Header().Get("Content-Type"), "application/json")
	assert.Equal(t, "*", rec.Header().Get("Access-Control-Allow-Origin"))
	etag := rec.Header().Get("ETag")
	require.NotEmpty(t, etag)
	assert.True(t, strings.HasPrefix(etag, `"sha256-`), "etag: %s", etag)

	var doc struct {
		OpenAPI string `json:"openapi"`
		Info    struct {
			Title string `json:"title"`
		} `json:"info"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &doc))
	assert.True(t, strings.HasPrefix(doc.OpenAPI, "3.1."), "openapi version: %s", doc.OpenAPI)
	assert.Equal(t, "Zitadel NextGen", doc.Info.Title)

	head := m.serve(httptest.NewRequest(http.MethodHead, openapibundled.Path, nil))
	require.Equal(t, http.StatusOK, head.Code)
	assert.Empty(t, head.Body.String())

	options := m.serve(httptest.NewRequest(http.MethodOptions, openapibundled.Path, nil))
	require.Equal(t, http.StatusNoContent, options.Code)
	assert.Equal(t, "*", options.Header().Get("Access-Control-Allow-Origin"))
	assert.Contains(t, options.Header().Get("Access-Control-Allow-Methods"), "GET")
	assert.Empty(t, options.Body.String())

	notModified := httptest.NewRequest(http.MethodGet, openapibundled.Path, nil)
	notModified.Header.Set("If-None-Match", etag)
	cached := m.serve(notModified)
	require.Equal(t, http.StatusNotModified, cached.Code)
	assert.Empty(t, cached.Body.String())

	gzipped := httptest.NewRequest(http.MethodGet, openapibundled.Path, nil)
	gzipped.Header.Set("Accept-Encoding", "br, gzip")
	compressed := m.serve(gzipped)
	require.Equal(t, http.StatusOK, compressed.Code)
	assert.Equal(t, "gzip", compressed.Header().Get("Content-Encoding"))
	assert.Equal(t, "Accept-Encoding", compressed.Header().Get("Vary"))
	assert.NotEqual(t, etag, compressed.Header().Get("ETag"), "each encoding is its own representation")
	assert.Less(t, compressed.Body.Len(), rec.Body.Len()/4)
	zr, err := gzip.NewReader(compressed.Body)
	require.NoError(t, err)
	inflated, err := io.ReadAll(zr)
	require.NoError(t, err)
	assert.Equal(t, rec.Body.Bytes(), inflated)

	refused := httptest.NewRequest(http.MethodGet, openapibundled.Path, nil)
	refused.Header.Set("Accept-Encoding", "gzip;q=0, identity")
	plain := m.serve(refused)
	assert.Empty(t, plain.Header().Get("Content-Encoding"))
	assert.Equal(t, rec.Body.Len(), plain.Body.Len())

	post := m.serve(httptest.NewRequest(http.MethodPost, openapibundled.Path, nil))
	assert.Equal(t, http.StatusMethodNotAllowed, post.Code)
	assert.Equal(t, "*", post.Header().Get("Access-Control-Allow-Origin"))
}

// RFC 9745: the date as a structured-field date, the link with the relation
// the RFC registers.
func TestRootPathDeprecationHeaders(t *testing.T) {
	t.Parallel()
	assert.Regexp(t, `^@[1-9][0-9]*$`, rootPathDeprecation)
	assert.Equal(t, `<https://preview.zitadel.com/docs/reference/api#base-url>; rel="deprecation"; type="text/html"`, rootPathDeprecationLink)
}

// A CORS preflight keeps ogen's answer on both spellings, and says nothing
// about deprecation: it names no operation.
func TestMountAPIAnswersAPreflightOnBothSpellings(t *testing.T) {
	t.Parallel()
	m := newMountedAPI(t)

	for _, path := range []string{"/api/v1/users/me", "/users/me"} {
		r := httptest.NewRequest(http.MethodOptions, path, nil)
		r.Header.Set("Origin", "https://app.example.com")
		r.Header.Set("Access-Control-Request-Method", http.MethodPatch)
		rec := m.serve(r)
		assert.Equal(t, http.StatusNoContent, rec.Code, path)
		assert.Equal(t, "GET,PATCH", rec.Header().Get("Access-Control-Allow-Methods"), path)
		assert.Empty(t, rec.Header().Get("Deprecation"), path)
	}
}

// The traffic the alias still carries is counted before GA removes it: its
// spans and its metrics carry RootPathAttribute, the prefix's and the root
// probes' do not. The metrics go through the views the server's meter
// provider drops other attributes with.
func TestMountAPIMarksRootPathTraffic(t *testing.T) {
	t.Parallel()
	m := newMountedAPI(t)

	for _, path := range []string{"/users/me", "/api/v1/users/me", "/livez", "/api/v1/livez"} {
		m.serve(httptest.NewRequest(http.MethodGet, path, nil))
	}

	marked := map[string]int{}
	unmarked := map[string]int{}
	for _, span := range m.spans.GetSpans() {
		if hasRootPathAttribute(span.Attributes) {
			marked[span.Name]++
		} else {
			unmarked[span.Name]++
		}
	}
	assert.Equal(t, map[string]int{string(api.GetMyUserOperation): 1}, marked, "spans at the root path")
	assert.Equal(t, map[string]int{string(api.GetMyUserOperation): 1, string(api.GetLiveOperation): 2}, unmarked, "other spans")

	var collected metricdata.ResourceMetrics
	require.NoError(t, m.metrics.Collect(t.Context(), &collected))
	var markedRequests, requests int64
	for _, scope := range collected.ScopeMetrics {
		for _, metric := range scope.Metrics {
			if metric.Name != "ogen.server.request_count" {
				continue
			}
			sum, ok := metric.Data.(metricdata.Sum[int64])
			require.True(t, ok, "request count is a sum, got %T", metric.Data)
			for _, point := range sum.DataPoints {
				requests += point.Value
				if hasRootPathAttribute(point.Attributes.ToSlice()) {
					markedRequests += point.Value
				}
			}
		}
	}
	assert.Equal(t, int64(4), requests, "every request to an operation is counted")
	assert.Equal(t, int64(1), markedRequests, "only the root path's is marked")
}

func hasRootPathAttribute(attributes []attribute.KeyValue) bool {
	for _, kv := range attributes {
		if kv == RootPathAttribute {
			return true
		}
	}
	return false
}
