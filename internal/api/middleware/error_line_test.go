package middleware_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/sloggcp"

	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/errreport"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

// enableErrorOrigins turns on location and stack capture for the errors the
// test builds, and turns it off again afterwards. Not parallel: globals.
func enableErrorOrigins(t *testing.T) {
	t.Helper()
	errreport.EnableLocation(true)
	errreport.EnableStack(true)
	t.Cleanup(func() {
		errreport.EnableLocation(false)
		errreport.EnableStack(false)
	})
}

// serveLines serves req behind WithLogging with a JSON request logger, as the
// server does, and returns the response and every line logged, parsed.
func serveLines(t *testing.T, req *http.Request, handler http.HandlerFunc) (*httptest.ResponseRecorder, []map[string]any) {
	t.Helper()
	var logs bytes.Buffer
	ctx := middleware.WithRequestIDContext(req.Context(), "req_1")
	ctx = zlog.WithLoggingContext(ctx, slog.New(slog.NewJSONHandler(&logs, nil)))
	rec := httptest.NewRecorder()
	middleware.WithLogging(handler).ServeHTTP(rec, req.WithContext(ctx))

	var lines []map[string]any
	for line := range bytes.Lines(logs.Bytes()) {
		var record map[string]any
		require.NoError(t, json.Unmarshal(line, &record))
		lines = append(lines, record)
	}
	return rec, lines
}

// errorLine returns the one error line among lines, ahead of the request
// line, or nil when the request got none.
func errorLine(t *testing.T, lines []map[string]any) map[string]any {
	t.Helper()
	require.NotEmpty(t, lines)
	require.Equal(t, "request served", lines[len(lines)-1]["msg"], "the request line comes last")
	switch len(lines) {
	case 1:
		return nil
	case 2:
		return lines[0]
	default:
		require.Failf(t, "one error line at most", "%v", lines)
		return nil
	}
}

// answer records err, when given, and writes status.
func answer(status int, err error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err != nil {
			middleware.RecordError(r.Context(), err)
		}
		w.WriteHeader(status)
	}
}

// A failed request gets exactly one error line, ahead of its request line:
// Info with the brief error for a 4xx, which keeps where it was raised but
// not the stack, and Error with the whole error for a 5xx. An error without
// a domain code is an internal one.
func TestWithLogging_oneErrorLinePerFailedRequest(t *testing.T) {
	enableErrorOrigins(t)
	for _, tc := range []struct {
		name      string
		status    int
		err       error
		wantLevel string
		wantCode  string
		wantStack bool
	}{
		{"a client error", http.StatusNotFound, domain.ErrRequestNotFound().WithParent(errors.New("no rows")), "INFO", "req.not_found", false},
		{"a server fault", http.StatusInternalServerError, domain.ErrInternal(errors.New("disk on fire")), "ERROR", "internal", true},
		{"an error without a domain code", http.StatusInternalServerError, errors.New("disk on fire"), "ERROR", "internal", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec, lines := serveLines(t, httptest.NewRequest(http.MethodGet, "/users/1", nil), func(w http.ResponseWriter, r *http.Request) {
				middleware.WithOperationIDContext(r.Context(), "getUser")
				answer(tc.status, tc.err)(w, r)
			})

			require.Equal(t, tc.status, rec.Code)
			line := errorLine(t, lines)
			require.NotNil(t, line)
			assert.Equal(t, tc.wantLevel, line["level"])
			assert.Equal(t, "api error", line["msg"])
			assert.EqualValues(t, tc.status, line["status"])
			assert.Equal(t, "getUser", line["operation_id"])
			assert.Equal(t, "req_1", line["request_id"])
			logged, ok := line[zlog.ErrorAttributeKey].(map[string]any)
			require.True(t, ok, "the error is a group: %v", line[zlog.ErrorAttributeKey])
			assert.Equal(t, tc.wantCode, logged["code"])
			assert.Contains(t, logged, "parent")
			assert.Contains(t, logged, "reportLocation")
			assert.Equal(t, tc.wantStack, logged["stackTrace"] != nil, "stack on Error lines only")
		})
	}
}

// A request that failed without a record still gets a line, so the gap is
// visible; a request that succeeded without one gets none.
func TestWithLogging_lineWithoutARecordedError(t *testing.T) {
	t.Run("4xx", func(t *testing.T) {
		_, lines := serveLines(t, httptest.NewRequest(http.MethodGet, "/", nil), answer(http.StatusNotFound, nil))

		line := errorLine(t, lines)
		require.NotNil(t, line)
		assert.Equal(t, "WARN", line["level"])
		assert.Equal(t, middleware.UnrecordedErrorMessage, line["msg"])
		assert.EqualValues(t, http.StatusNotFound, line["status"])
		assert.Contains(t, line, "operation_id")
		assert.NotContains(t, line, zlog.ErrorAttributeKey)
	})

	t.Run("2xx", func(t *testing.T) {
		_, lines := serveLines(t, httptest.NewRequest(http.MethodGet, "/", nil), answer(http.StatusOK, nil))

		assert.Nil(t, errorLine(t, lines))
	})
}

// The last error recorded is the one the line carries: a panic is recovered
// after everything else.
func TestWithLogging_lastRecordWins(t *testing.T) {
	_, lines := serveLines(t, httptest.NewRequest(http.MethodGet, "/", nil), func(w http.ResponseWriter, r *http.Request) {
		middleware.RecordError(r.Context(), domain.ErrRequestNotFound())
		middleware.RecordError(r.Context(), domain.ErrInternal(errors.New("panic: boom")))
		w.WriteHeader(http.StatusInternalServerError)
	})

	line := errorLine(t, lines)
	require.NotNil(t, line)
	assert.Equal(t, "ERROR", line["level"])
	assert.Equal(t, "internal", line[zlog.ErrorAttributeKey].(map[string]any)["code"])
}

// A server fault the client gave up on is logged at Warn, briefly, whatever
// error its going away caused, unless net/http ended the request at the
// server's write deadline. Whether the client is there is read when the
// error is recorded, and a record without the request's cancel says it does
// not matter, as a panic does.
func TestWithLogging_clientGoneIsAWarning(t *testing.T) {
	enableErrorOrigins(t)
	for _, tc := range []struct {
		name          string
		cause         error
		canceled      bool
		withoutCancel bool
		wantLevel     string
	}{
		{name: "client gone while the body is written", cause: fmt.Errorf("write response: %w", &net.OpError{Op: "write", Net: "tcp", Err: errors.New("broken pipe")}), canceled: true, wantLevel: "WARN"},
		{name: "canceled error on a live request", cause: fmt.Errorf("query projects: %w", context.Canceled), wantLevel: "ERROR"},
		{name: "server write deadline", cause: fmt.Errorf("write response: %w", &net.OpError{Op: "write", Net: "tcp", Err: os.ErrDeadlineExceeded}), canceled: true, wantLevel: "ERROR"},
		{name: "recorded without the cancel", cause: errors.New("panic: boom"), canceled: true, withoutCancel: true, wantLevel: "ERROR"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			if tc.canceled {
				cancel()
			}
			_, lines := serveLines(t, httptest.NewRequestWithContext(ctx, http.MethodGet, "/", nil), func(w http.ResponseWriter, r *http.Request) {
				ctx := r.Context()
				if tc.withoutCancel {
					ctx = context.WithoutCancel(ctx)
				}
				middleware.RecordError(ctx, domain.ErrInternal(tc.cause))
				w.WriteHeader(http.StatusInternalServerError)
			})

			line := errorLine(t, lines)
			require.NotNil(t, line)
			assert.Equal(t, tc.wantLevel, line["level"])
			logged := line[zlog.ErrorAttributeKey].(map[string]any)
			assert.Equal(t, tc.wantLevel == "ERROR", logged["stackTrace"] != nil, "stack on Error lines only")
		})
	}
}

// A panic after the response started is answered with the status the client
// already got, and is still a bug: the line says Error.
func TestWithLogging_recordedServerFaultIsAnErrorWhateverTheStatus(t *testing.T) {
	_, lines := serveLines(t, httptest.NewRequest(http.MethodGet, "/", nil), answer(http.StatusCreated, domain.ErrInternal(errors.New("panic: boom"))))

	line := errorLine(t, lines)
	require.NotNil(t, line)
	assert.Equal(t, "ERROR", line["level"])
	assert.EqualValues(t, http.StatusCreated, line["status"])
}

// A dependency that did not answer is the operator's to look at even when
// the client got an answer it can act on, so its line says Warn; one that is
// also a server fault keeps Error.
func TestWithLogging_dependencyFaultIsAWarning(t *testing.T) {
	for _, tc := range []struct {
		name      string
		status    int
		err       error
		wantLevel string
	}{
		{name: "a provider unavailable behind a step rejection", status: http.StatusBadRequest, err: domain.ErrFlowStepRejected().WithParent(domain.ErrFlowSSOUnavailable(errors.New("discovery timed out"))), wantLevel: "WARN"},
		// A bare one is a server fault, and stays Error as before.
		{name: "a provider unavailable answered as such", status: http.StatusBadRequest, err: domain.ErrFlowSSOUnavailable(errors.New("discovery timed out")), wantLevel: "ERROR"},
		{name: "the database unavailable", status: http.StatusServiceUnavailable, err: domain.ErrUnavailable(), wantLevel: "ERROR"},
		{name: "a client error", status: http.StatusBadRequest, err: domain.ErrFlowInvalidAction(), wantLevel: "INFO"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, lines := serveLines(t, httptest.NewRequest(http.MethodPost, "/", nil), answer(tc.status, tc.err))

			line := errorLine(t, lines)
			require.NotNil(t, line)
			assert.Equal(t, tc.wantLevel, line["level"])
			assert.EqualValues(t, tc.status, line["status"])
		})
	}
}

// Attributes recorded with the error sit on its line.
func TestWithLogging_logsTheRecordedAttributes(t *testing.T) {
	_, lines := serveLines(t, httptest.NewRequest(http.MethodGet, "/", nil), func(w http.ResponseWriter, r *http.Request) {
		middleware.RecordError(r.Context(), domain.ErrInternal(errors.New("refused")), slog.String("return_target", "https://app.example/login"))
		w.WriteHeader(http.StatusInternalServerError)
	})

	line := errorLine(t, lines)
	require.NotNil(t, line)
	assert.Equal(t, "https://app.example/login", line["return_target"])
}

// A route without WithLogging has nothing to record into.
func TestRecordError_withoutAHolder(t *testing.T) {
	t.Parallel()
	middleware.RecordError(t.Context(), domain.ErrInternal(nil))

	_, ok := middleware.RecordedError(t.Context())
	assert.False(t, ok)
}

func TestRecordedError(t *testing.T) {
	t.Parallel()
	err := domain.ErrRequestNotFound()
	var recorded error
	var ok bool
	serveLines(t, httptest.NewRequest(http.MethodGet, "/", nil), func(w http.ResponseWriter, r *http.Request) {
		_, before := middleware.RecordedError(r.Context())
		assert.False(t, before)
		middleware.RecordError(r.Context(), err)
		recorded, ok = middleware.RecordedError(r.Context())
		w.WriteHeader(http.StatusNotFound)
	})

	require.True(t, ok)
	assert.Equal(t, err, recorded)
}

// errorRecord returns the error line's record for a request answered with
// status after recording err, before any handler resolves its values.
func errorRecord(t *testing.T, status int, err error) slog.Record {
	t.Helper()
	var records []slog.Record
	ctx := zlog.WithLoggingContext(t.Context(), slog.New(recordingHandler{records: &records}))
	req := httptest.NewRequest(http.MethodGet, "/", nil).WithContext(ctx)
	middleware.WithLogging(answer(status, err)).ServeHTTP(httptest.NewRecorder(), req)
	require.Len(t, records, 2)
	require.Equal(t, "api error", records[0].Message)
	return records[0]
}

func loggedErrorValue(t *testing.T, record slog.Record) slog.Value {
	t.Helper()
	var logged slog.Value
	record.Attrs(func(a slog.Attr) bool {
		if a.Key == zlog.ErrorAttributeKey {
			logged = a.Value
		}
		return true
	})
	return logged
}

// gcpReport is what the GCP error reporting handler writes for record.
func gcpReport(t *testing.T, record slog.Record) string {
	t.Helper()
	var out bytes.Buffer
	require.NoError(t, sloggcp.NewErrorReportingHandler(&out, nil).Handle(t.Context(), record))
	return out.String()
}

// A line below Error level carries no stack in any mode. A text or JSON
// handler reads the error through its log value, which keeps the location;
// GCP error reporting builds a report from any `error` attribute and reads
// the location and stack through the error's interfaces, at every level. A
// 5xx keeps both.
func TestWithLogging_briefLinesCarryNoStackInGCPMode(t *testing.T) {
	enableErrorOrigins(t)
	notFound := domain.ErrRequestNotFound().WithParent(errors.New("no rows in result set"))
	internal := domain.ErrInternal(errors.New("disk on fire"))

	t.Run("plain mode", func(t *testing.T) {
		logged := loggedErrorValue(t, errorRecord(t, http.StatusNotFound, notFound)).Resolve()
		require.Equal(t, slog.KindGroup, logged.Kind())
		var keys []string
		for _, attr := range logged.Group() {
			keys = append(keys, attr.Key)
		}
		require.ElementsMatch(t, []string{"code", "message", "parent", "reportLocation"}, keys)
	})

	t.Run("gcp mode", func(t *testing.T) {
		errreport.GCPReporting(true)
		t.Cleanup(func() { errreport.GCPReporting(false) })

		brief := gcpReport(t, errorRecord(t, http.StatusNotFound, notFound))
		require.Contains(t, brief, notFound.Message)
		require.NotContains(t, brief, "goroutine")
		require.NotContains(t, brief, "unsupported type")

		require.Contains(t, gcpReport(t, errorRecord(t, http.StatusInternalServerError, internal)), "goroutine")
	})
}

// recordingHandler keeps every record as logged, before any handler
// resolves its values.
type recordingHandler struct{ records *[]slog.Record }

func (h recordingHandler) Enabled(context.Context, slog.Level) bool { return true }

func (h recordingHandler) Handle(_ context.Context, r slog.Record) error {
	*h.records = append(*h.records, r.Clone())
	return nil
}

func (h recordingHandler) WithAttrs([]slog.Attr) slog.Handler { return h }

func (h recordingHandler) WithGroup(string) slog.Handler { return h }
