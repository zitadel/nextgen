package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/baggage"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	"github.com/zitadel/nextgen/internal/instrumentation"
	"github.com/zitadel/nextgen/internal/instrumentation/zotel"
)

const (
	callerTraceID = "4bf92f3577b34da6a3ce929d0e0e4736"
	callerSpanID  = "00f067aa0ba902b7"
)

func callerTraceparent(flags string) string {
	return "00-" + callerTraceID + "-" + callerSpanID + "-" + flags
}

// TestIncomingTraceContext pins ADR 068 against the real tracer provider and
// sampler the server uses: an incoming traceparent is ignored unless
// instrumentation.trace.trust_remote_spans is set, in which case the server
// span is a child of the caller's span.
func TestIncomingTraceContext(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		trust       bool
		fraction    float64
		traceparent string
		// wantSpan is whether the server span is sampled and so reaches the exporter.
		wantSpan bool
		// wantContinued is whether the span belongs to the caller's trace.
		wantContinued bool
	}{
		{
			name:          "off ignores a sampled caller and starts a new trace",
			trust:         false,
			fraction:      1,
			traceparent:   callerTraceparent("01"),
			wantSpan:      true,
			wantContinued: false,
		},
		{
			name:        "off lets a sampled caller force nothing when the fraction is 0",
			trust:       false,
			fraction:    0,
			traceparent: callerTraceparent("01"),
			wantSpan:    false,
		},
		{
			name:          "on continues a sampled caller's trace",
			trust:         true,
			fraction:      1,
			traceparent:   callerTraceparent("01"),
			wantSpan:      true,
			wantContinued: true,
		},
		{
			name:          "on follows a sampled caller's flag even when the fraction is 0",
			trust:         true,
			fraction:      0,
			traceparent:   callerTraceparent("01"),
			wantSpan:      true,
			wantContinued: true,
		},
		{
			name:          "on continues an unsampled caller's trace and applies the fraction",
			trust:         true,
			fraction:      1,
			traceparent:   callerTraceparent("00"),
			wantSpan:      true,
			wantContinued: true,
		},
		{
			name:        "on drops an unsampled caller's trace when the fraction is 0",
			trust:       true,
			fraction:    0,
			traceparent: callerTraceparent("00"),
			wantSpan:    false,
		},
		{
			name:          "on without a traceparent starts a new trace",
			trust:         true,
			fraction:      1,
			traceparent:   "",
			wantSpan:      true,
			wantContinued: false,
		},
		{
			name:          "on ignores a malformed traceparent",
			trust:         true,
			fraction:      1,
			traceparent:   "not-a-traceparent",
			wantSpan:      true,
			wantContinued: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			recorder := tracetest.NewSpanRecorder()
			tp, err := zotel.NewTracerProvider(t.Context(), zotel.ExporterConfig{Type: zotel.ExporterTypeNone}, tt.fraction, resource.Empty())
			require.NoError(t, err)
			tp.RegisterSpanProcessor(recorder)
			t.Cleanup(func() { require.NoError(t, tp.Shutdown(context.Background())) })

			var (
				gotBaggage baggage.Baggage
				gotLogCtx  trace.SpanContext
			)
			// Stands in for the ogen server, which starts its server span
			// from the request context.
			api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotBaggage = baggage.FromContext(r.Context())
				gotLogCtx = trace.SpanContextFromContext(r.Context())
				_, span := tp.Tracer("test").Start(r.Context(), "GET /ping", trace.WithSpanKind(trace.SpanKindServer))
				span.End()
			})
			propagator := propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{})
			handler := withIncomingTraceContext(instrumentation.TraceConfig{TrustRemoteSpans: tt.trust}, propagator, api)

			req := httptest.NewRequest(http.MethodGet, "/ping", nil)
			if tt.traceparent != "" {
				req.Header.Set("traceparent", tt.traceparent)
				req.Header.Set("tracestate", "vendor=caller")
				req.Header.Set("baggage", "tenant=acme")
			}
			handler.ServeHTTP(httptest.NewRecorder(), req)

			spans := recorder.Ended()
			if !tt.wantSpan {
				assert.Empty(t, spans, "the span must not be sampled")
				return
			}
			require.Len(t, spans, 1)
			span := spans[0]
			sc := span.SpanContext()
			require.True(t, sc.IsValid())

			if !tt.wantContinued {
				assert.NotEqual(t, callerTraceID, sc.TraceID().String(), "must not adopt the caller's trace ID")
				assert.False(t, span.Parent().IsValid(), "must be a root span")
				assert.Empty(t, sc.TraceState().String(), "must not carry the caller's tracestate")
				if !tt.trust {
					assert.Zero(t, gotBaggage.Len(), "must not carry the caller's baggage")
				}
				return
			}
			assert.Equal(t, callerTraceID, sc.TraceID().String())
			assert.Equal(t, callerSpanID, span.Parent().SpanID().String(), "the caller's span must be the parent")
			assert.True(t, span.Parent().IsRemote())
			assert.NotEqual(t, callerSpanID, sc.SpanID().String())
			assert.Equal(t, "vendor=caller", sc.TraceState().String())
			assert.Equal(t, "acme", gotBaggage.Member("tenant").Value())
			assert.Equal(t, callerTraceID, gotLogCtx.TraceID().String(), "the request context must carry the caller's trace for the request logs")
		})
	}
}

// TestIncomingTraceContextOffIsPassThrough pins that a disabled setting adds
// no handler at all.
func TestIncomingTraceContextOffIsPassThrough(t *testing.T) {
	t.Parallel()

	var called bool
	next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true })
	got := withIncomingTraceContext(instrumentation.TraceConfig{}, propagation.TraceContext{}, next)

	got.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	assert.True(t, called)
}

func TestLoadConfigTrustRemoteSpans(t *testing.T) {
	emptyConfig := func(t *testing.T) string {
		t.Helper()
		configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
		require.NoError(t, os.WriteFile(configPath, nil, 0o600))
		return configPath
	}

	t.Run("defaults to off", func(t *testing.T) {
		t.Setenv("NEXTGEN_SERVER_DATA_DIR", t.TempDir())
		cfg, err := loadConfig(emptyConfig(t))
		require.NoError(t, err)
		assert.False(t, cfg.Instrumentation.Trace.TrustRemoteSpans)
	})

	t.Run("is set from the environment", func(t *testing.T) {
		t.Setenv("NEXTGEN_SERVER_DATA_DIR", t.TempDir())
		t.Setenv("NEXTGEN_INSTRUMENTATION_TRACE_TRUST_REMOTE_SPANS", "true")
		cfg, err := loadConfig(emptyConfig(t))
		require.NoError(t, err)
		assert.True(t, cfg.Instrumentation.Trace.TrustRemoteSpans)
	})

	t.Run("is set from yaml", func(t *testing.T) {
		t.Setenv("NEXTGEN_SERVER_DATA_DIR", t.TempDir())
		configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
		require.NoError(t, os.WriteFile(configPath, []byte("instrumentation:\n  trace:\n    trust_remote_spans: true\n"), 0o600))
		cfg, err := loadConfig(configPath)
		require.NoError(t, err)
		assert.True(t, cfg.Instrumentation.Trace.TrustRemoteSpans)
	})
}
