package audit

import (
	"net/http"
	"time"

	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/events"
)

type statusCapturingWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusCapturingWriter) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusCapturingWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(b)
}

func (w *statusCapturingWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func (w *statusCapturingWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// WithRequestEventMiddleware enqueues Path A request.api events after the
// handler when project_id is known (authenticated API, public login/flow, or
// POST /projects after the new id is stamped). Probes (healthz) leave
// project_id empty and are skipped.
func WithRequestEventMiddleware(buf *RequestBuffer, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ctx := WithActorSlot(r.Context())
		r = r.WithContext(ctx)
		sw := &statusCapturingWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)

		if buf == nil {
			return
		}
		ac, ok := ActorSlotFromContext(r.Context())
		if !ok || ac == nil || ac.ProjectID == "" {
			return
		}
		status := sw.status
		if status == 0 {
			status = http.StatusOK
		}
		operationID, _ := middleware.GetOperationIDContext(r.Context())
		// Prefer ServeMux pattern when available; ogen mounts under "/" so fall
		// back to operation_id (stable) instead of raw path (leaks resource ids).
		route := r.Pattern
		if route == "" || route == "/" {
			route = operationID
		}
		payload, err := events.MarshalPayload(domain.RequestAPIPayload{
			OperationID:   operationID,
			Method:        r.Method,
			RouteTemplate: route,
			Status:        status,
			DurationMs:    time.Since(start).Milliseconds(),
		})
		if err != nil {
			return
		}
		ev := FromContext(WithActorContext(r.Context(), *ac), domain.EventTypeRequestAPI, domain.EventCategoryRequest)
		ev.ProjectID = ac.ProjectID
		ev.Payload = payload
		buf.EnqueueSince(ev, start)
	})
}
