package api

import (
	"context"
	"net/http"

	"github.com/zitadel/nextgen/internal/domain"
)

// idpCallbackPath is the route the provider sends the browser back to,
// under the request origin. The `/__nextgen` prefix is the client-side proxy
// prefix a scaffolded app strips before forwarding.
const idpCallbackPath = "/__nextgen/idp/callback"

// ssoBindingCookieName is the browser-binding cookie's name. The `__Host-`
// prefix requires Secure, so an http development origin, where Secure is
// dropped for Safari (see cookieSecureFromContext), drops the prefix too.
func ssoBindingCookieName(secure bool) string {
	if secure {
		return "__Host-_zsso"
	}
	return "_zsso"
}

// ssoBindingSetCookie is the Set-Cookie value that binds the callback to
// this browser. SameSite=Lax, not Strict: the callback is a cross-site
// top-level GET, which a Strict cookie is not sent with. It lives as long
// as the attempt the state record belongs to.
func ssoBindingSetCookie(ctx context.Context, nonce string) string {
	secure := cookieSecureFromContext(ctx)
	return (&http.Cookie{
		Name:     ssoBindingCookieName(secure),
		Value:    nonce,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		Path:     "/",
		MaxAge:   int(domain.AuthAttemptTTL.Seconds()),
	}).String()
}
