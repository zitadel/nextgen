package middleware_test

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
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

func TestWithLogging_clientErrorLogsWarnWithoutBody(t *testing.T) {
	var handler recordHandler
	logger := slog.New(&handler)
	ctx := zlog.WithLoggingContext(context.Background(), logger)

	mw := middleware.WithLogging(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"code":"user.not_found","message":"not found"}`))
	}))

	req := httptest.NewRequest(http.MethodGet, "/users/1", nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	mw.ServeHTTP(rec, req)

	var rejected *slog.Record
	for i := range handler.records {
		if handler.records[i].Message == "request rejected" {
			rejected = &handler.records[i]
			break
		}
	}
	require.NotNil(t, rejected)
	assert.Equal(t, slog.LevelWarn, rejected.Level)
	code, ok := attrString(t, *rejected, "error_code")
	require.True(t, ok)
	assert.Equal(t, "user.not_found", code)
	_, hasResponse := attrString(t, *rejected, "response")
	assert.False(t, hasResponse)
}

func TestWithLogging_serverErrorLogsError(t *testing.T) {
	var handler recordHandler
	logger := slog.New(&handler)
	ctx := zlog.WithLoggingContext(context.Background(), logger)

	mw := middleware.WithLogging(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"code":"internal","message":"oops"}`))
	}))

	req := httptest.NewRequest(http.MethodGet, "/boom", nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	mw.ServeHTTP(rec, req)

	var failed *slog.Record
	for i := range handler.records {
		if handler.records[i].Message == "request failed" {
			failed = &handler.records[i]
			break
		}
	}
	require.NotNil(t, failed)
	assert.Equal(t, slog.LevelError, failed.Level)
}

func TestWithLogging_successLogsInfo(t *testing.T) {
	var handler recordHandler
	logger := slog.New(&handler)
	ctx := zlog.WithLoggingContext(context.Background(), logger)

	mw := middleware.WithLogging(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true,"payload":"should-not-be-parsed"}`))
	}))

	req := httptest.NewRequest(http.MethodGet, "/ok", nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	mw.ServeHTTP(rec, req)

	var handled *slog.Record
	for i := range handler.records {
		if handler.records[i].Message == "handled request" {
			handled = &handler.records[i]
			break
		}
	}
	require.NotNil(t, handled)
	assert.Equal(t, slog.LevelInfo, handled.Level)
	_, hasErrorCode := attrString(t, *handled, "error_code")
	assert.False(t, hasErrorCode)
}
