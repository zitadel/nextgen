package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"github.com/zitadel/zitadel/v5/internal/instrumentation/zlog"
)

func getLoggingContext(ctx context.Context) *slog.Logger {
	logger := zlog.GetLoggingContext(ctx)
	logger = zlog.WithStream(logger, zlog.StreamRequest)
	return logger
}

// WithLogging logs each request. The values of the query parameters named in
// redactQuery are hidden in the request line: a route whose query carries a
// secret opts in where it is mounted, and every other route logs its query as
// received.
func WithLogging(next http.Handler, redactQuery ...string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		// ensure context has logger with request id inside
		logger := zlog.GetLoggingContext(ctx)
		requestID, _ := GetRequestIDContext(ctx)
		logger = logger.With("request_id", requestID)
		ctx = zlog.WithLoggingContext(ctx, logger)
		r = r.WithContext(ctx)

		logger = getLoggingContext(ctx)
		urlValue, uriValue := r.URL.String(), r.RequestURI
		if redacted, ok := redactedQueryURL(r.URL, redactQuery); ok {
			urlValue, uriValue = redacted, redacted
		}
		logger.Info("handling request",
			slog.String("method", r.Method),
			slog.String("url", urlValue),
			slog.String("uri", uriValue),
		)

		start := time.Now()

		// Already set the operation id so that the value exists on the context.
		// Since the value is wrapped, it can be set by the ogen middleware and
		// retrieved later in this function. Since ogen middleware always runs
		// after net/http middleware, this will not overwrite anything
		ctx = WithOperationIDContext(ctx, "")

		lrw := &loggingResponseWriter{
			ResponseWriter: w,
			errorBody:      bytes.NewBuffer(nil),
		}
		next.ServeHTTP(lrw, r.WithContext(ctx))

		if lrw.statusCode == 0 {
			lrw.statusCode = http.StatusOK
		}

		operationID, _ := GetOperationIDContext(ctx)
		duration := time.Since(start)

		if lrw.statusCode < http.StatusBadRequest {
			logger.Info("handled request",
				slog.Int("status_code", lrw.statusCode),
				slog.Duration("duration", duration),
				slog.String("operation_id", operationID),
			)
			return
		}

		// Only buffer+parse error responses (≥400). Success bodies are never
		// buffered, so JSON decode cannot run on the hot 2xx path.
		attrs := []any{
			slog.Int("status_code", lrw.statusCode),
			slog.Duration("duration", duration),
			slog.String("operation_id", operationID),
		}
		if code := extractWireErrorCode(lrw.errorBody.Bytes()); code != "" {
			attrs = append(attrs, slog.String("error_code", code))
		}
		if lrw.statusCode >= http.StatusInternalServerError {
			logger.Error("request failed", attrs...)
			return
		}
		logger.Warn("request rejected", attrs...)
	})
}

// wireErrorCode is the minimal API error envelope shape for request logging.
// Only the code field is extracted; the body is never logged (ADR 030).
type wireErrorCode struct {
	Code string `json:"code"`
}

func extractWireErrorCode(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	var envelope wireErrorCode
	if err := json.Unmarshal(body, &envelope); err != nil {
		return ""
	}
	return envelope.Code
}

// redactedQueryURL hides the values of the named query parameters. It reports
// false when the URL carries none of them, and the caller logs the request
// line as received.
func redactedQueryURL(u *url.URL, names []string) (string, bool) {
	query := u.Query()
	redacted := false
	for _, name := range names {
		if _, ok := query[name]; ok {
			query.Set(name, "redacted")
			redacted = true
		}
	}
	if !redacted {
		return "", false
	}
	clone := *u
	clone.RawQuery = query.Encode()
	return clone.String(), true
}

// ---------------------- LOGGING RESPONSE WRITER -----------------------------

// loggingResponseWriter is a wrapper around an http.ResponseWriter which caches
// the status-code. For error responses it buffers the body only so the wire
// error code can be extracted for structured logs without logging the payload.
type loggingResponseWriter struct {
	http.ResponseWriter
	statusCode int
	errorBody  *bytes.Buffer
}

func (w *loggingResponseWriter) WriteHeader(code int) {
	w.statusCode = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *loggingResponseWriter) Write(b []byte) (int, error) {
	switch {
	case w.statusCode == 0:
		w.statusCode = http.StatusOK
	case w.statusCode >= http.StatusBadRequest:
		w.errorBody.Write(b)
	}
	return w.ResponseWriter.Write(b)
}
