package middleware

import (
	"bytes"
	"log/slog"
	"net/http"
	"time"

	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

func WithLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		requestID, _ := GetRequestIDContext(ctx)
		logger := zlog.GetLoggingContext(ctx).With( // get logger from context or create default logger
			slog.String("method", r.Method),
			slog.String("url", r.URL.String()),
			slog.String("uri", r.RequestURI),
			slog.String("request_id", requestID),
		)
		r = r.WithContext(zlog.WithLoggingContext(ctx, logger))
		next.ServeHTTP(w, r)
	})
}

func WithPreRequestLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		logger := zlog.GetLoggingContext(r.Context())
		logger.Info("handling request")
		next.ServeHTTP(w, r)
	})
}

func WithPostRequestLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ctx := r.Context()

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

		operationID, _ := GetOperationIDContext(ctx)
		logger := zlog.GetLoggingContext(ctx)

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

func WithLogging(next http.Handler) http.Handler {
	return WithLogger(
		WithPreRequestLogging(
			WithPostRequestLogging(next),
		),
	)
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
