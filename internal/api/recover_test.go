package api

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/errreport"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

// A panicking handler answers the standard internal error and is logged as
// one API error at Error, with the panic's stack even when stack capture is
// off.
func TestWithRecoverAnswersPanicWithInternalError(t *testing.T) {
	errreport.EnableStack(false)
	rec, records := serveAndRecordLogs(t, errorStubHandler{panicValue: "boom"}, nil,
		httptest.NewRequest(http.MethodGet, "/livez", nil))

	require.Equal(t, http.StatusInternalServerError, rec.Code)
	require.Equal(t, "application/json", rec.Header().Get("Content-Type"))
	require.JSONEq(t, `{"code":"internal","message":"An unexpected error occurred."}`, rec.Body.String())
	require.Len(t, records, 1)
	record := records[0]
	require.Equal(t, "ERROR", record["level"])
	require.Equal(t, "api error", record["msg"])
	require.EqualValues(t, http.StatusInternalServerError, record["status"])
	require.Equal(t, "getLive", record["operation_id"])
	require.Equal(t, "req_1", record["request_id"])
	logged := record["error"].(map[string]any)
	require.Equal(t, "internal", logged["code"])
	require.Equal(t, "panic: boom", logged["message"], "the panic names the report")
	require.Contains(t, logged["parent"], "panic: boom")
	require.NotEmpty(t, logged["stackTrace"])
}

// A panic is a bug whoever is still listening: a client that already left
// does not turn it into a Warn.
func TestWithRecoverLogsPanicAtErrorAfterTheClientLeft(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	_, records := serveAndRecordLogs(t, errorStubHandler{panicValue: "boom"}, nil,
		httptest.NewRequestWithContext(ctx, http.MethodGet, "/livez", nil))

	require.Len(t, records, 1)
	require.Equal(t, "ERROR", records[0]["level"])
}

// A panic after the response started cannot be answered any more: the
// connection is aborted, so the client never takes the truncated response
// for a success. The panic is still logged at Error, with the status the
// client got.
func TestWithRecoverAbortsAStartedResponse(t *testing.T) {
	records := recordLogs(t)
	h := middleware.WithLogging(WithRecover(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
		panic("boom")
	})))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = req.WithContext(zlog.WithLoggingContext(req.Context(), slog.Default()))

	require.PanicsWithValue(t, http.ErrAbortHandler, func() {
		h.ServeHTTP(httptest.NewRecorder(), req)
	})
	logged := records()
	require.Len(t, logged, 2, "the error line and the request line")
	require.Equal(t, "ERROR", logged[0]["level"])
	require.Equal(t, "api error", logged[0]["msg"])
	require.EqualValues(t, http.StatusCreated, logged[0]["status"])
	require.Equal(t, "panic: boom", logged[0]["error"].(map[string]any)["message"])
	require.Equal(t, "request served", logged[1]["msg"])
}

// A flushed response has started: a later panic must not write a second
// status.
func TestHeaderTrackingWriterFlushStartsTheResponse(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	w := &headerTrackingWriter{ResponseWriter: rec}

	w.Flush()

	require.True(t, w.wroteHeader)
	require.True(t, rec.Flushed)
}

// http.NewResponseController reaches the writer underneath.
func TestHeaderTrackingWriterUnwrapsTheInnerWriter(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()

	require.Equal(t, http.ResponseWriter(rec), (&headerTrackingWriter{ResponseWriter: rec}).Unwrap())
}

// net/http aborts a response with http.ErrAbortHandler and expects to see it.
func TestWithRecoverRepanicsAbortHandler(t *testing.T) {
	t.Parallel()
	h := WithRecover(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic(http.ErrAbortHandler)
	}))

	require.PanicsWithValue(t, http.ErrAbortHandler, func() {
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	})
}
