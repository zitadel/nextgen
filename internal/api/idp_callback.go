package api

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/service"
)

// idpCallbackErrorPage is the one answer for every failed callback: the
// handler has no return target to send the browser to, and one page for
// unknown, consumed and tampered states alike means a state value cannot be
// probed. It is a constant: nothing from the request is reflected into it.
const idpCallbackErrorPage = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Sign-in failed</title></head>
<body><p>The sign-in could not be completed. Return to the application and try again.</p></body>
</html>
`

// ssoCallbackProcessor is the service half of the callback route
// ([service.FlowSSOCallback]).
type ssoCallbackProcessor interface {
	Process(ctx context.Context, in service.FlowSSOCallbackInput) (service.FlowSSOCallbackOutput, error)
}

// IDPCallbackHandler answers the provider's redirect on [IDPCallbackPath]. It
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
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx := r.Context()
	query := r.URL.Query()
	in := service.FlowSSOCallbackInput{
		State:            query.Get("state"),
		Code:             query.Get("code"),
		Error:            query.Get("error"),
		ErrorDescription: query.Get("error_description"),
		ErrorURI:         query.Get("error_uri"),
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
		writeIDPCallbackErrorPage(w, http.StatusBadRequest)
		return
	}
	if err != nil {
		// Process logs ceremony failures itself; what reaches here is a bug in
		// the process, logged with its cause before the cause-free page. A
		// cancelled request is the client leaving, not a bug; a deadline is
		// still logged.
		if !errors.Is(ctx.Err(), context.Canceled) {
			zlog.GetLoggingContext(ctx).Error("sso callback processing failed", slog.Any("error", err))
		}
		writeIDPCallbackErrorPage(w, http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, out.ReturnTarget, http.StatusSeeOther)
}

func writeIDPCallbackErrorPage(w http.ResponseWriter, status int) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, idpCallbackErrorPage)
}