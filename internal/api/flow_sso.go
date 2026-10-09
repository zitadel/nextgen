package api

import (
	"context"
	"net/http"
	"net/url"

	"github.com/zitadel/nextgen/internal/domain"
)

const idpCallbackProxyPrefix = "/__nextgen"

const IDPCallbackUpstreamPattern = "/idp/{" + idpCallbackSlugWildcard + "}/callback"
const IDPCallbackPattern = idpCallbackProxyPrefix + IDPCallbackUpstreamPattern

const idpCallbackSlugWildcard = "slug"

func IDPCallbackPath(slug string) string {
	return idpCallbackProxyPrefix + IDPCallbackUpstreamPath(slug)
}

func IDPCallbackUpstreamPath(slug string) string {
	return "/idp/" + url.PathEscape(slug) + "/callback"
}

func IDPCallbackPathPrefixes() []string {
	return []string{idpCallbackProxyPrefix + "/idp", "/idp"}
}

// ssoBindingCookieName is the browser-binding cookie's name. The `__Host-`
// prefix requires Secure, so an http loopback host, where Secure is dropped
// for Safari (see cookieSecureFromContext), drops the prefix too. Non-loopback
// http keeps the prefix and Secure, and the browser discards the cookie: such
// a deployment is unsupported. The callback must pick the name through this
// function from its own request; a submit and a callback that reach the
// server over different schemes do not find each other's cookie.
func ssoBindingCookieName(secure bool) string {
	if secure {
		return "__Host-_zsso"
	}
	return "_zsso"
}

// ssoBindingSetCookie is the Set-Cookie value that binds the callback to
// this browser. SameSite=Lax, not Strict: the callback is a cross-site
// top-level GET, which a Strict cookie is not sent with. It gets the
// attempt's full TTL from this submission, so it outlives the record by the
// time already spent on the step; a lingering cookie is inert, the record
// holds only the hash of its nonce.
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
