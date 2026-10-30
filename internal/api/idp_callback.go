package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"go.opentelemetry.io/otel/trace"

	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/errorpage"
	"github.com/zitadel/nextgen/internal/httputil"
	"github.com/zitadel/nextgen/internal/service"
)

// The one page for every failed callback: the handler has no return target to
// send the browser to, so it offers no way on, and one page for unknown,
// consumed and tampered states alike means a state value cannot be probed.
// Nothing from the request is reflected into it.
const (
	idpCallbackFailedTitle       = "Sign-in failed"
	idpCallbackFailedDescription = "The sign-in could not be completed. Return to the application and try again."
)

// ssoCallbackProcessor is the service half of the callback route
// ([service.FlowSSOCallback]).
type ssoCallbackProcessor interface {
	Process(ctx context.Context, in service.FlowSSOCallbackInput) (service.FlowSSOCallbackOutput, error)
}

// IDPCallbackHandler answers the provider's redirect on [IDPCallbackPattern]. It
// is a plain net/http handler, not an API operation: the request shape is
// RFC 6749's, the browser arriving here carries no API credential, and the
// response is a redirect or an error page, never JSON.
type IDPCallbackHandler struct {
	callback ssoCallbackProcessor
}

func NewIDPCallbackHandler(callback ssoCallbackProcessor) *IDPCallbackHandler {
	return &IDPCallbackHandler{callback: callback}
}

func (h *IDPCallbackHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// The route is not an ogen operation, so it sets its own operation id for
	// the request log and the request.api event: one key for both mounts.
	ctx := middleware.WithOperationIDContext(r.Context(), "idpCallback")
	// For the same reason it starts its own server span, which the request
	// line reads its IDs from.
	ctx, span := tracer.Start(ctx, "idpCallback", trace.WithSpanKind(trace.SpanKindServer))
	defer span.End()
	middleware.SetServerSpanContext(ctx, span.SpanContext())
	if r.Method != http.MethodGet {
		middleware.RecordError(ctx, domain.ErrRequestMethodNotAllowed())
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	query := r.URL.Query()
	in := service.FlowSSOCallbackInput{
		ConnectionSlug:   r.PathValue(idpCallbackSlugWildcard),
		State:            query.Get("state"),
		Code:             query.Get("code"),
		Error:            query.Get("error"),
		ErrorDescription: query.Get("error_description"),
		ErrorURI:         query.Get("error_uri"),
		Issuer:           query.Get("iss"),
	}
	// The cookie name depends on the scheme of this request, the same way the
	// submit chose it (see ssoBindingCookieName); a missing cookie stays "",
	// which never matches the record.
	if cookie, err := r.Cookie(ssoBindingCookieName(cookieSecureFromContext(ctx))); err == nil {
		in.BindingNonce = cookie.Value
	}
	// The response is per-user and single-use either way.
	w.Header().Set("Cache-Control", "private, no-store")
	out, err := h.callback.Process(ctx, in)
	if errors.Is(err, domain.ErrSSOStateInvalid()) {
		middleware.RecordError(ctx, err)
		writeIDPCallbackErrorPage(w, r, http.StatusBadRequest)
		return
	}
	if err != nil {
		// Process logs ceremony failures itself; what reaches here is a bug in
		// the process, recorded with its cause for the error line ahead of the
		// cause-free page.
		middleware.RecordError(ctx, err)
		writeIDPCallbackErrorPage(w, r, http.StatusInternalServerError)
		return
	}
	// The target was checked when the sign-in started. It is checked again
	// where it is used, so a target stored before the check was as strict as it
	// is now can never be redirected to.
	if _, err := httputil.ParseRedirectTarget(out.ReturnTarget); err != nil {
		middleware.RecordError(ctx, err, slog.String("return_target", out.ReturnTarget))
		writeIDPCallbackErrorPage(w, r, http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, out.ReturnTarget, http.StatusSeeOther)
}

func writeIDPCallbackErrorPage(w http.ResponseWriter, r *http.Request, status int) {
	errorpage.Write(w, r, errorpage.Page{
		Status:      status,
		Title:       idpCallbackFailedTitle,
		Description: idpCallbackFailedDescription,
	})
}
