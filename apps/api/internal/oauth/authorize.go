package oauth

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strings"

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
)

// AuthRequestStore stores an authorization request with its expiry and
// binding, and returns the nonce the browser's binding cookie holds.
type AuthRequestStore interface {
	Create(ctx context.Context, request *domain.AuthRequest) (bindingNonce string, err error)
}

// VerifyAuthRequest finds the issuer and the client. Its errors are answered
// here and never reach the client, because the redirect URI is not checked
// yet: an issuer this server does not serve is a 404, an unknown client a 400.
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
	doc, err := s.clients.Client(ctx, issuer.ProjectID, settings.DeploymentID, r.Data.ClientID)
	if err != nil {
		if domain.IsServerFault(err) {
			return nil, op.NewStatusError(oidc.ErrServerError().WithParent(err), http.StatusInternalServerError)
		}
		return nil, op.NewStatusError(oidc.ErrInvalidClient().WithDescription("unknown client"), http.StatusBadRequest)
	}
	c := newClient(r.Data.ClientID, doc, r.Data.RedirectURI)
	c.settings = settings
	return &op.ClientRequest[oidc.AuthRequest]{Request: r, Client: c}, nil
}

// Authorize stores the request and sends the browser to the issuer's login
// page with the request's handle, binding the handle to the browser with a
// cookie (ADR 081 §8). The redirect URI is valid here, so an error the
// client can act on goes back to it.
func (s opServer) Authorize(ctx context.Context, r *op.ClientRequest[oidc.AuthRequest]) (*op.Redirect, error) {
	req := r.Data
	c := r.Client.(*client)
	if req.RequestParam != "" {
		return nil, oidc.ErrRequestNotSupported()
	}
	// The metadata offers the query mode only.
	if req.ResponseMode != "" && req.ResponseMode != oidc.ResponseModeQuery {
		return nil, oidc.ErrInvalidRequest().WithDescription("response_mode must be query")
	}
	if !slices.Contains(c.grantTypes, oidc.GrantTypeCode) {
		return nil, oidc.ErrUnauthorizedClient().WithDescription("the client may not use the authorization code grant")
	}
	// The library reads a missing method as plain; this server accepts S256 only.
	if req.CodeChallenge != "" && req.CodeChallengeMethod != oidc.CodeChallengeMethodS256 {
		return nil, oidc.ErrInvalidRequest().WithDescription("code_challenge_method must be S256")
	}
	issuer, _ := IssuerFromContext(ctx)
	login, err := loginURL(issuer, r.Header.Get(LoginPathHeader))
	if err != nil {
		return nil, op.NewStatusError(oidc.ErrInvalidRequest().WithDescription("invalid login path"), http.StatusBadRequest)
	}
	request := &domain.AuthRequest{
		ProjectID:     issuer.ProjectID,
		ClientID:      c.id,
		RedirectURI:   req.RedirectURI,
		State:         req.State,
		Scopes:        req.Scopes,
		CodeChallenge: req.CodeChallenge,
		Issuer:        issuer.URL.String(),
		DeploymentID:  c.settings.DeploymentID,
		ReleaseID:     c.settings.ReleaseID,
	}
	nonce, err := s.authRequests.Create(ctx, request)
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
		return nil, errors.New("the login path is not a path")
	}
	raw := issuer.Origin() + loginPath
	u, err := httputil.ParseRedirectTarget(raw)
	if err != nil {
		return nil, err
	}
	if u.String() != raw || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return nil, errors.New("the login path is not a plain path")
	}
	return u, nil
}

// bindingCookie binds the request's handle to the browser that started it.
// Each request has its own cookie, so a second request in the same browser
// does not end the first (ADR 081 §8.3). The name is `__Host-` prefixed
// unless the issuer is plain http on loopback, where a browser refuses
// Secure cookies (ADR 083).
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

// errorPageFor is the page for status. Its text is fixed: the library's
// description can quote the request.
func errorPageFor(status int) errorpage.Page {
	switch {
	case status == http.StatusNotFound:
		return errorpage.NotFound(nil)
	case status >= http.StatusInternalServerError:
		return errorpage.Page{
			Status:      status,
			Title:       "Sign-in could not start",
			Description: "Something went wrong on our side. Go back to the app and try again in a moment.",
		}
	default:
		return errorpage.Page{
			Status:      status,
			Title:       "Sign-in could not start",
			Description: "The app sent a sign-in request this server cannot accept. Go back to the app and try again.",
		}
	}
}
