package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/idp"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/service"
)

// LegacyIDPCallbackPatterns are the mux patterns of the Zitadel v4 callback
// URLs, served on every host ([idp.LegacyCallbackPaths]). Mount the
// [IDPCallbackHandler] on each.
func LegacyIDPCallbackPatterns() []string {
	return slices.Clone(idp.LegacyCallbackPaths)
}

func isLegacyIDPCallbackPattern(pattern string) bool {
	return slices.Contains(idp.LegacyCallbackPaths, pattern)
}

// relayLegacy answers a provider redirect on a Zitadel v4 callback URL, which
// a migrated connection keeps in `oidc.redirect_uri` so the provider needs no
// new registration. The binding cookie lives on the origin the sign-in
// started on, so the callback is finished there: the browser is sent to that
// origin's own callback route with the query unchanged. When the sign-in
// started on this origin, it is finished here.
func (h *IDPCallbackHandler) relayLegacy(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	origin, ok := requestOriginFromContext(ctx)
	if !ok {
		writeIDPCallbackErrorPage(w, r, http.StatusBadRequest)
		return
	}
	out, err := h.callback.ResolveLegacy(ctx, service.FlowSSOLegacyCallbackInput{
		RequestURL: origin + r.URL.EscapedPath(),
		State:      r.URL.Query().Get("state"),
	})
	if errors.Is(err, domain.ErrSSOStateInvalid()) {
		writeIDPCallbackErrorPage(w, r, http.StatusBadRequest)
		return
	}
	if err != nil {
		if !errors.Is(ctx.Err(), context.Canceled) {
			zlog.GetLoggingContext(ctx).Error("sso legacy callback resolution failed", slog.Any("error", err))
		}
		writeIDPCallbackErrorPage(w, r, http.StatusInternalServerError)
		return
	}
	if strings.EqualFold(out.ReturnOrigin, origin) {
		h.finish(ctx, w, r, out.ConnectionSlug)
		return
	}
	target := out.ReturnOrigin + IDPCallbackPath(out.ConnectionSlug)
	if r.URL.RawQuery != "" {
		target += "?" + r.URL.RawQuery
	}
	http.Redirect(w, r, target, http.StatusSeeOther)
}
