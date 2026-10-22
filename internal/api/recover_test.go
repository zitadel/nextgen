package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

// A panicking handler answers the standard internal error and logs its stack
// once, at Error.
func TestWithRecoverAnswersPanicWithInternalError(t *testing.T) {
	rec, records := serveAndRecordLogs(t, errorStubHandler{panicValue: "boom"}, nil,
		httptest.NewRequest(http.MethodGet, "/healthz", nil))

	require.Equal(t, http.StatusInternalServerError, rec.Code)
	require.Equal(t, "application/json", rec.Header().Get("Content-Type"))
	require.JSONEq(t, `{"code":"internal","message":"An unexpected error occurred."}`, rec.Body.String())
	require.Len(t, records, 1)
	record := records[0]
	require.Equal(t, "ERROR", record["level"])
	require.Equal(t, "handler panicked", record["msg"])
	require.Equal(t, "boom", record["panic"])
	require.NotEmpty(t, record["stack"])
	require.Equal(t, "getHealth", record["operation_id"])
	require.Equal(t, "req_1", record["request_id"])
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
