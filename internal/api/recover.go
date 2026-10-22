package api

import (
	"log/slog"
	"net/http"
	"runtime/debug"

	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

// WithRecover turns a handler panic into the standard internal error
// response and one Error log line with the stack. http.ErrAbortHandler is
// re-panicked, as net/http expects.
func WithRecover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tw := &headerTrackingWriter{ResponseWriter: w}
		defer func() {
			p := recover()
			if p == nil {
				return
			}
			if p == http.ErrAbortHandler {
				panic(p)
			}
			ctx := r.Context()
			operationID, _ := middleware.GetOperationIDContext(ctx)
			// The stack is always attached: a panic is a bug, whatever the
			// error stack trace setting says.
			zlog.Error(ctx, "handler panicked",
				slog.Any("panic", p),
				slog.String("stack", string(debug.Stack())),
				slog.String("operation_id", operationID),
			)
			if !tw.wroteHeader {
				writeErrorDetails(w, http.StatusInternalServerError, domainErrorDetails(domain.ErrInternal(nil)))
			}
		}()
		next.ServeHTTP(tw, r)
	})
}

// headerTrackingWriter records whether the response has started, after which
// a panic can no longer be answered with an error body.
type headerTrackingWriter struct {
	http.ResponseWriter
	wroteHeader bool
}

func (w *headerTrackingWriter) WriteHeader(code int) {
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(code)
}

func (w *headerTrackingWriter) Write(b []byte) (int, error) {
	w.wroteHeader = true
	return w.ResponseWriter.Write(b)
}

// Flush keeps streaming working through the wrapper; flushing sends the
// headers.
func (w *headerTrackingWriter) Flush() {
	w.wroteHeader = true
	_ = http.NewResponseController(w.ResponseWriter).Flush()
}

// Unwrap lets http.NewResponseController reach the writer underneath.
func (w *headerTrackingWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}
