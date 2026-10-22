package middleware_test

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	slogctx "github.com/veqryn/slog-context"
	slogotel "github.com/veqryn/slog-context/otel"
	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog/extractors"
)

type recordHandler struct {
	records []slog.Record
}

func (h *recordHandler) Enabled(context.Context, slog.Level) bool { return true }

func (h *recordHandler) Handle(_ context.Context, r slog.Record) error {
	h.records = append(h.records, r)
	return nil
}

func (h *recordHandler) WithAttrs(attrs []slog.Attr) slog.Handler { return h }

func (h *recordHandler) WithGroup(name string) slog.Handler { return h }

func attrString(t *testing.T, r slog.Record, key string) (string, bool) {
	t.Helper()
	var value string
	var found bool
	r.Attrs(func(attr slog.Attr) bool {
		if attr.Key == key {
			value = attr.Value.String()
			found = true
			return false
		}
		return true
	})
	return value, found
}

// serve runs handler behind WithLogging for one request and returns the single
// record it logged.
func serve(t *testing.T, target string, handler http.HandlerFunc) (slog.Record, *httptest.ResponseRecorder) {
	t.Helper()
	var records recordHandler
	ctx := zlog.WithLoggingContext(context.Background(), slog.New(&records))
	req := httptest.NewRequest(http.MethodGet, target, nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	middleware.WithLogging(handler).ServeHTTP(rec, req)
	require.Len(t, records.records, 1, "exactly one line per request")
	return records.records[0], rec
}

func TestWithLogging_oneInfoLinePerRequest(t *testing.T) {
	for _, status := range []int{http.StatusOK, http.StatusNotFound, http.StatusInternalServerError} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			record, _ := serve(t, "/users/1", func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(status)
			})

			assert.Equal(t, slog.LevelInfo, record.Level)
			assert.Equal(t, "request served", record.Message)
			for _, key := range []string{"method", "path", "operation_id", "status", "response_size", "duration"} {
				_, ok := attrString(t, record, key)
				assert.True(t, ok, key)
			}
			method, _ := attrString(t, record, "method")
			assert.Equal(t, http.MethodGet, method)
			path, _ := attrString(t, record, "path")
			assert.Equal(t, "/users/1", path)
			operationID, _ := attrString(t, record, "operation_id")
			assert.Empty(t, operationID)
			got, _ := attrString(t, record, "status")
			assert.Equal(t, fmt.Sprint(status), got)
		})
	}
}

func TestWithLogging_logsThePathWithoutTheQuery(t *testing.T) {
	record, _ := serve(t, "/__nextgen/idp/google/callback?code=the-code&state=the-state", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusSeeOther)
	})

	path, _ := attrString(t, record, "path")
	assert.Equal(t, "/__nextgen/idp/google/callback", path)
	record.Attrs(func(attr slog.Attr) bool {
		assert.NotContains(t, attr.Value.String(), "the-code", attr.Key)
		assert.NotContains(t, attr.Value.String(), "the-state", attr.Key)
		return true
	})
}

func TestWithLogging_responseSizeCountsEveryWrite(t *testing.T) {
	record, _ := serve(t, "/ok", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"ok":`))
		_, _ = w.Write([]byte(`true}`))
	})

	size, _ := attrString(t, record, "response_size")
	assert.Equal(t, fmt.Sprint(len(`{"ok":true}`)), size)
	status, _ := attrString(t, record, "status")
	assert.Equal(t, "200", status)
}

func TestWithLogging_emptyResponseIs200(t *testing.T) {
	record, _ := serve(t, "/ok", func(http.ResponseWriter, *http.Request) {})

	status, _ := attrString(t, record, "status")
	assert.Equal(t, "200", status)
	size, _ := attrString(t, record, "response_size")
	assert.Equal(t, "0", size)
}

func TestWithLogging_flushBeforeWriteIs200(t *testing.T) {
	record, rec := serve(t, "/stream", func(w http.ResponseWriter, _ *http.Request) {
		require.NoError(t, http.NewResponseController(w).Flush())
	})

	assert.True(t, rec.Flushed, "the inner writer was flushed")
	status, _ := attrString(t, record, "status")
	assert.Equal(t, "200", status)
}

func TestWithLogging_unwrapReachesTheInnerWriter(t *testing.T) {
	var inner http.ResponseWriter
	_, rec := serve(t, "/", func(w http.ResponseWriter, _ *http.Request) {
		unwrapper, ok := w.(interface{ Unwrap() http.ResponseWriter })
		require.True(t, ok)
		inner = unwrapper.Unwrap()
	})

	assert.Same(t, rec, inner)
}

// The request id is set on the request logger, so it reaches the access line
// and every line the handler logs, with or without a context, exactly once.
func TestWithLogging_carriesTheRequestID(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slogctx.NewHandler(slog.NewTextHandler(&logs, nil), &slogctx.HandlerOptions{
		Prependers: []slogctx.AttrExtractor{
			extractors.ExtractErrCause,
			slogotel.ExtractTraceSpanID,
			slogctx.ExtractPrepended,
		},
	}))
	ctx := middleware.WithRequestIDContext(zlog.WithLoggingContext(context.Background(), logger), "req_1")
	req := httptest.NewRequest(http.MethodGet, "/", nil).WithContext(ctx)
	middleware.WithLogging(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		zlog.GetLoggingContext(r.Context()).Warn("handler line")
	})).ServeHTTP(httptest.NewRecorder(), req)

	lines := strings.Split(strings.TrimSpace(logs.String()), "\n")
	require.Len(t, lines, 2)
	assert.Contains(t, lines[0], "handler line")
	assert.Contains(t, lines[1], "request served")
	for _, line := range lines {
		assert.Equal(t, 1, strings.Count(line, "request_id=req_1"), line)
	}
}

// ogen's middleware fills the holder WithLogging put on the context, and the
// access line reads it back.
func TestWithLogging_logsTheOperationID(t *testing.T) {
	record, _ := serve(t, "/healthz", func(_ http.ResponseWriter, r *http.Request) {
		middleware.WithOperationIDContext(r.Context(), "getHealth")
	})

	operationID, _ := attrString(t, record, "operation_id")
	assert.Equal(t, "getHealth", operationID)
}

// A panic after the response started keeps propagating, and the request still
// gets its line with the status the client saw.
func TestWithLogging_logsAPanickingRequest(t *testing.T) {
	var records recordHandler
	ctx := zlog.WithLoggingContext(context.Background(), slog.New(&records))
	req := httptest.NewRequest(http.MethodGet, "/", nil).WithContext(ctx)
	mw := middleware.WithLogging(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
		panic(http.ErrAbortHandler)
	}))

	require.PanicsWithValue(t, http.ErrAbortHandler, func() { mw.ServeHTTP(httptest.NewRecorder(), req) })
	require.Len(t, records.records, 1)
	assert.Equal(t, "request served", records.records[0].Message)
	status, _ := attrString(t, records.records[0], "status")
	assert.Equal(t, "201", status)
}
