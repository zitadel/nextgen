package middleware

import (
	"bytes"
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

func WithLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		// ensure context has logger with request id inside
		logger := zlog.GetLoggingContext(ctx)
		requestID, _ := GetRequestIDContext(ctx)
		logger = logger.With("request_id", requestID)
		ctx = zlog.WithLoggingContext(ctx, logger)
		r = r.WithContext(ctx)

		logger = getLoggingContext(ctx)
		logger.Info("handling request",
			slog.String("method", r.Method),
			slog.String("url", r.URL.String()),
			slog.String("uri", r.RequestURI),
		)

		start := time.Now()

		// Already set the operation id so that the value exists on the context.
		// Since the value is wrapped, it can be set by the ogen middleware and
		// retrieved later in this function. Since ogen middleware always runs
		// after net/http middleware, this will not overwrite anything
		ctx = WithOperationIDContext(ctx, "")

		lrw := &loggingResponseWriter{
			ResponseWriter: w,
			body:           bytes.NewBuffer(nil),
		}
		next.ServeHTTP(lrw, r.WithContext(ctx))

		if lrw.statusCode == 0 {
			lrw.statusCode = http.StatusOK
		}

		operationID, _ := GetOperationIDContext(ctx)

		if lrw.statusCode >= 400 {
			logger.Error("error while handling request",
				slog.Int("status_code", lrw.statusCode),
				slog.Duration("duration", time.Since(start)),
				slog.String("response", lrw.body.String()),
				slog.String("operation_id", operationID),
			)
		} else {
			logger.Info("handled request",
				slog.Int("status_code", lrw.statusCode),
				slog.Duration("duration", time.Since(start)),
				slog.String("operation_id", operationID),
			)
		}
	})
}

// ---------------------- LOGGING RESPONSE WRITER -----------------------------

// loggingResponseWriter is a wrapper around an http.ResponseWriter which caches
// the status-code. It also caches the body if the status-code is an error code.
type loggingResponseWriter struct {
	http.ResponseWriter
	statusCode int
	body       *bytes.Buffer
}

func (w *loggingResponseWriter) WriteHeader(code int) {
	w.statusCode = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *loggingResponseWriter) Write(b []byte) (int, error) {
	switch {
	case w.statusCode == 0:
		w.statusCode = http.StatusOK
	case w.statusCode >= 400:
		w.body.Write(b)
	}
	return w.ResponseWriter.Write(b)
}
