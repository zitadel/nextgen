package middleware

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

func getLoggingContext(ctx context.Context) *slog.Logger {
	logger := zlog.GetLoggingContext(ctx)
	logger = zlog.WithStream(logger, zlog.StreamRequest)
	return logger
}

// WithLogging logs one Info line per request once the handler returns,
// whatever the status. The path is logged without its query, so no query
// value (an authorization code, a single-use state) reaches the log. Errors
// are logged by the API error sink, not here.
func WithLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		// ensure context has logger with request id inside
		requestID, _ := GetRequestIDContext(ctx)
		logger := zlog.GetLoggingContext(ctx).With("request_id", requestID)
		ctx = zlog.WithLoggingContext(ctx, logger)
		r = r.WithContext(ctx)

		logger = getLoggingContext(ctx)
		start := time.Now()

		// Already set the operation id so that the value exists on the context.
		// Since the value is wrapped, it can be set by the ogen middleware and
		// retrieved later in this function. Since ogen middleware always runs
		// after net/http middleware, this will not overwrite anything
		ctx = WithOperationIDContext(ctx, "")

		lrw := &loggingResponseWriter{ResponseWriter: w}
		next.ServeHTTP(lrw, r.WithContext(ctx))

		status := lrw.statusCode
		if status == 0 {
			status = http.StatusOK
		}
		operationID, _ := GetOperationIDContext(ctx)
		logger.InfoContext(ctx, "request served",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.String("operation_id", operationID),
			slog.Int("status", status),
			slog.Int64("response_size", lrw.bytes),
			slog.Duration("duration", time.Since(start)),
		)
	})
}

// ---------------------- LOGGING RESPONSE WRITER -----------------------------

// loggingResponseWriter records the status and the number of body bytes
// written, for the request line.
type loggingResponseWriter struct {
	http.ResponseWriter
	statusCode int
	bytes      int64
}

func (w *loggingResponseWriter) WriteHeader(code int) {
	if w.statusCode == 0 {
		w.statusCode = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *loggingResponseWriter) Write(b []byte) (int, error) {
	if w.statusCode == 0 {
		w.statusCode = http.StatusOK
	}
	n, err := w.ResponseWriter.Write(b)
	w.bytes += int64(n)
	return n, err
}

// Flush keeps streaming working through the wrapper; flushing sends the
// headers.
func (w *loggingResponseWriter) Flush() {
	if w.statusCode == 0 {
		w.statusCode = http.StatusOK
	}
	_ = http.NewResponseController(w.ResponseWriter).Flush()
}

// Unwrap lets http.NewResponseController reach the writer underneath.
func (w *loggingResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}
