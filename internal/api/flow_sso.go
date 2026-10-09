package api

import (
	"context"
	"fmt"
	"net/http"
	"net/url"

	"github.com/zitadel/nextgen/internal/domain"
)

// idpCallbackProxyPrefix is the prefix a scaffolded app's SDK middleware
// proxies (its default proxyPath) and strips before forwarding.
const idpCallbackProxyPrefix = "/__nextgen"

// IDPCallbackUpstreamPattern is the route the provider sends the browser back
// to, as it arrives through a scaffolded app's SDK middleware: one per
// connection, named by its slug.
//
// The path, not the state, names the connection the provider answered. A
// shared route would let a malicious provider send the browser on to an
// honest one, whose code then reaches the malicious provider's token endpoint
// with the state it pinned (the mix-up attack, RFC 9700 §4.4). The callback
// refuses a path that names another connection than the state pins. The
// defense rests on each provider matching redirect_uri exactly, which is why
// the callback also checks RFC 9207's `iss` when a provider sends one.
const IDPCallbackUpstreamPattern = "/idp/{" + idpCallbackSlugWildcard + "}/callback"

// IDPCallbackPattern is [IDPCallbackUpstreamPattern] under the request origin
// when the instance is the browser origin itself (hosted login).
const IDPCallbackPattern = idpCallbackProxyPrefix + IDPCallbackUpstreamPattern

// idpCallbackSlugWildcard is the path wildcard holding the connection slug in
// both patterns.
const idpCallbackSlugWildcard = "slug"

// retiredIDPCallbackPaths are both spellings of the shared callback route the
// per-connection routes replaced. A provider registered before the change
// still sends the browser there.
var retiredIDPCallbackPaths = []string{idpCallbackProxyPrefix + "/idp/callback", "/idp/callback"}

// IDPCallbackPath is the callback path of the connection slug, matching
// [IDPCallbackPattern]. The slug is fixed for the life of a connection, so the
// path stays the same across revisions and is what the developer registers at
// the provider.
func IDPCallbackPath(slug string) string {
	return idpCallbackProxyPrefix + IDPCallbackUpstreamPath(slug)
}

// IDPCallbackUpstreamPath is [IDPCallbackPath] as the SDK proxy forwards it,
// matching [IDPCallbackUpstreamPattern].
func IDPCallbackUpstreamPath(slug string) string {
	return "/idp/" + url.PathEscape(slug) + "/callback"
}

// MountIDPCallback mounts the callback on both spellings of its route, and the
// retired shared route on both of its own, wrapping each handler with wrap
// (the server's middleware chain). The patterns are more specific than an API
// catch-all, so they win over it. A mount that conflicts with a pattern
// already on mux, such as a UI path configured under /idp/, is returned as an
// error rather than ServeMux's panic.
func MountIDPCallback(mux *http.ServeMux, callback http.Handler, wrap func(http.Handler) http.Handler) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("mount the idp callback: %v", r)
		}
	}()
	wrapped := wrap(callback)
	mux.Handle(IDPCallbackPattern, wrapped)
	mux.Handle(IDPCallbackUpstreamPattern, wrapped)
	retired := wrap(http.HandlerFunc(serveRetiredIDPCallback))
	for _, path := range retiredIDPCallbackPaths {
		mux.Handle(path, retired)
	}
	return nil
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
