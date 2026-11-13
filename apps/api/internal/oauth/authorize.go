package oauth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/zitadel/oidc/v3/pkg/oidc"
	"github.com/zitadel/oidc/v3/pkg/op"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/errorpage"
	"github.com/zitadel/nextgen/internal/httputil"
)

const (
	// LoginPathHeader carries the path of the app's login page. The SDK proxy
	// sets it on every request it forwards (ADR 081 §7).
	LoginPathHeader  = "X-Zitadel-Login-Path"
	defaultLoginPath = "/login"
	// noScope stands in for a missing scope. No client allows it, so the
	// library drops it.
	noScope = "urn:zitadel:no-scope"
	// maxStateBytes bounds the state every request stores. It leaves room for
	// clients that encrypt their sign-in's properties into state.
	maxStateBytes = 2048
	// temporarilyUnavailable tells the client it may retry (RFC 6749
	// §4.1.2.1). The library has no constructor for it.
	temporarilyUnavailable = "temporarily_unavailable"
)

// AuthRequestStore stores an authorization request with its expiry and
// binding, and returns the nonce the browser's binding cookie holds.
type AuthRequestStore interface {
	Create(ctx context.Context, request *domain.AuthRequest) (bindingNonce string, err error)
}

// VerifyAuthRequest finds the issuer and the client.
func (s opServer) VerifyAuthRequest(ctx context.Context, r *op.Request[oidc.AuthRequest]) (*op.ClientRequest[oidc.AuthRequest], error) {
	issuer, ok := IssuerFromContext(ctx)
	if !ok {
		return nil, metadataError(issuerError(ctx))
	}
	settings, err := s.settings.Get(ctx, issuer)
	if err != nil {
		return nil, metadataError(err)
	}
	if !settings.Enabled {
		return nil, noMetadata()
	}
	// Every stored request names its deployment (ADR 081 §10); a source that
	// leaves them out would store requests no flow can serve.
	if settings.DeploymentID == "" || settings.ReleaseID == "" {
		return nil, metadataError(domain.ErrInternal(errors.New("the OAuth settings name no deployment or release")))
	}
	unknownClient := op.NewStatusError(oidc.ErrInvalidClient().WithDescription("unknown client"), http.StatusBadRequest)
	// A lookup with text a dialect cannot hold fails as a 500.
	if !storable(r.Data.ClientID) {
		return nil, unknownClient
	}
	doc, err := s.clients.Client(ctx, issuer.ProjectID, settings.DeploymentID, r.Data.ClientID)
	switch {
	case errors.Is(err, domain.ErrApplicationNotFound()):
		return nil, unknownClient
	case errors.Is(err, domain.ErrUnavailable()):
		return nil, op.NewStatusError((&oidc.Error{ErrorType: temporarilyUnavailable}).WithParent(err), http.StatusServiceUnavailable)
	case err != nil:
		return nil, op.NewStatusError(oidc.ErrServerError().WithParent(err), http.StatusInternalServerError)
	}
	// TODO(zitadel/oidc#1041): drop the placeholder once an op.Server client
	// can allow a request without a scope, which the library refuses.
	if len(r.Data.Scopes) == 0 {
		r.Data.Scopes = oidc.SpaceDelimitedArray{noScope}
	}
	c := newClient(r.Data.ClientID, doc)
	c.settings = settings
	return &op.ClientRequest[oidc.AuthRequest]{Request: r, Client: c}, nil
}

// Authorize stores the request and sends the browser to the issuer's login
// page with the request's handle, binding the handle to the browser with a
// cookie (ADR 081 §8).
func (s opServer) Authorize(ctx context.Context, r *op.ClientRequest[oidc.AuthRequest]) (*op.Redirect, error) {
	req := r.Data
	c := r.Client.(*client)
	if req.RequestParam != "" {
		return nil, oidc.ErrRequestNotSupported()
	}
	// With PKCE optional, state is what protects the client from CSRF.
	if req.State == "" {
		return nil, oidc.ErrInvalidRequest().WithDescription("state is required")
	}
	// state is stored, so it must be text every dialect can hold.
	if !storable(req.State) {
		return nil, oidc.ErrInvalidRequest().WithDescription("state must be UTF-8 without NUL")
	}
	if len(req.State) > maxStateBytes {
		return nil, oidc.ErrInvalidRequest().WithDescription("state must be at most %d bytes", maxStateBytes)
	}
	// The metadata offers the query mode only.
	if req.ResponseMode != "" && req.ResponseMode != oidc.ResponseModeQuery {
		return nil, oidc.ErrInvalidRequest().WithDescription("response_mode must be query")
	}
	if !slices.Contains(c.grantTypes, oidc.GrantTypeCode) {
		return nil, oidc.ErrUnauthorizedClient().WithDescription("the client's grant_types do not include authorization_code")
	}
	// Until consent ships, a request may not ask for it (ADR 082, step 2).
	if slices.Contains(req.Prompt, oidc.PromptConsent) {
		return nil, oidc.ErrUnauthorizedClient().WithDescription("consent is not supported yet")
	}
	if req.CodeChallenge != "" {
		// The library reads a missing method as plain; this server accepts S256 only.
		if req.CodeChallengeMethod != oidc.CodeChallengeMethodS256 {
			return nil, oidc.ErrInvalidRequest().WithDescription("code_challenge_method must be S256")
		}
		if digest, err := base64.RawURLEncoding.DecodeString(req.CodeChallenge); err != nil || len(digest) != sha256.Size {
			return nil, oidc.ErrInvalidRequest().WithDescription("code_challenge must be a base64url SHA-256 digest")
		}
	}
	issuer, _ := IssuerFromContext(ctx)
	login, err := loginURL(issuer, r.Header.Get(LoginPathHeader))
	if err != nil {
		return nil, op.NewStatusError(oidc.ErrInvalidRequest().WithDescription("invalid login path").WithParent(err), http.StatusBadRequest)
	}
	// The server does not serve the standard scopes yet, so they are ignored
	// (ADR 082 §2). The library keeps them and drops every other scope.
	// TODO(ADR 082 step 3): keep the scopes the server serves once OpenID
	// Connect ships.
	scopes := slices.DeleteFunc(req.Scopes, func(scope string) bool {
		switch scope {
		case oidc.ScopeOpenID, oidc.ScopeProfile, oidc.ScopeEmail, oidc.ScopeAddress, oidc.ScopePhone, oidc.ScopeOfflineAccess:
			return true
		}
		return false
	})
	request := &domain.AuthRequest{
		ProjectID:     issuer.ProjectID,
		ClientID:      c.id,
		RedirectURI:   req.RedirectURI,
		State:         req.State,
		Scopes:        scopes,
		CodeChallenge: req.CodeChallenge,
		Issuer:        issuer.URL.String(),
		DeploymentID:  c.settings.DeploymentID,
		ReleaseID:     c.settings.ReleaseID,
	}
	nonce, err := s.authRequests.Create(ctx, request)
	if errors.Is(err, domain.ErrUnavailable()) {
		return nil, (&oidc.Error{ErrorType: temporarilyUnavailable}).WithParent(err)
	}
	if err != nil {
		return nil, oidc.ErrServerError().WithParent(err)
	}
	login.RawQuery = url.Values{"auth_request": {request.ID}}.Encode()
	header := http.Header{"Set-Cookie": {bindingCookie(issuer, request.ID, nonce)}}
	return &op.Redirect{URL: login.String(), Header: header}, nil
}

// loginURL is the issuer's login page: its origin and loginPath, or
// defaultLoginPath when the request carries none. loginPath comes from the
// request, so it must be a path on the issuer's own origin, with no query or
// fragment.
func loginURL(issuer Issuer, loginPath string) (*url.URL, error) {
	if loginPath == "" {
		loginPath = defaultLoginPath
	}
	// A leading slash keeps the origin: ParseRedirectTarget refuses "//host".
	if !strings.HasPrefix(loginPath, "/") {
		return nil, fmt.Errorf("the login path %q does not start with a slash", loginPath)
	}
	raw := issuer.Origin() + loginPath
	u, err := httputil.ParseRedirectTarget(raw)
	if err != nil {
		return nil, err
	}
	if u.String() != raw || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return nil, fmt.Errorf("the login path %q has a query or fragment, or is not in canonical form", loginPath)
	}
	return u, nil
}

// bindingCookie binds the request's handle to the browser that started it.
// Each request has its own cookie, so a second request in the same browser
// does not end the first (ADR 081 §8.3). The name is `__Host-` prefixed
// unless the issuer is plain http on loopback, where Safari drops Secure
// cookies (ADR 083).
func bindingCookie(issuer Issuer, handle, nonce string) string {
	secure := issuer.URL.Scheme != "http" || !domain.IsLoopbackOrigin(issuer.Origin())
	name := "_zauth_" + handle
	if secure {
		name = "__Host-" + name
	}
	return (&http.Cookie{
		Name:     name,
		Value:    nonce,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		Path:     "/",
		MaxAge:   int(domain.AuthRequestTTL.Seconds()),
	}).String()
}

// withErrorPages answers a browser navigation's error with the error page
// instead of the library's JSON (ADR 076). A program keeps the JSON.
func withErrorPages(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !errorpage.Wants(r) {
			next.ServeHTTP(w, r)
			return
		}
		next.ServeHTTP(&errorPageWriter{ResponseWriter: w, r: r}, r)
	})
}

// errorPageWriter writes the error page in place of an error status and
// drops the body the library writes after it.
type errorPageWriter struct {
	http.ResponseWriter
	r        *http.Request
	replaced bool
}

func (w *errorPageWriter) WriteHeader(status int) {
	if status < http.StatusBadRequest {
		w.ResponseWriter.WriteHeader(status)
		return
	}
	w.replaced = true
	errorpage.Write(w.ResponseWriter, w.r, errorPageFor(status))
}

func (w *errorPageWriter) Write(b []byte) (int, error) {
	if w.replaced {
		return len(b), nil
	}
	return w.ResponseWriter.Write(b)
}

// errorPageFor is the page for status, in ADR 076 §4's words. A refusal has
// no sentence: the library's description can quote the request.
func errorPageFor(status int) errorpage.Page {
	switch {
	case status == http.StatusNotFound:
		return errorpage.NotFound(nil)
	case status >= http.StatusInternalServerError:
		return errorpage.Page{
			Status:      status,
			Title:       "Something went wrong",
			Description: "The server could not complete this request. Try again in a moment.",
		}
	default:
		return errorpage.Page{Status: status, Title: "Request failed"}
	}
}

// storable reports whether s is text every dialect stores: UTF-8 without NUL.
func storable(s string) bool {
	return utf8.ValidString(s) && !strings.ContainsRune(s, 0)
}
