package oauth

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
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
	"github.com/zitadel/nextgen/internal/instrumentation/errlog"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

const (
	// LoginPathHeader carries the path of the app's login page. The SDK proxy
	// sets it on every request it forwards (ADR 081 §7).
	LoginPathHeader  = "X-Zitadel-Login-Path"
	defaultLoginPath = "/login"
	// noScope stands in for a missing scope. No client allows it, so the
	// library drops it.
	noScope = "urn:zitadel:no-scope"
	// maxStateBytes bounds the state every request stores, since any caller
	// can start a request. No spec sets a limit. This one leaves room for
	// clients that encrypt their sign-in's properties into state, and raising
	// it later breaks no client.
	maxStateBytes = 2048
	// temporarilyUnavailable tells the client it may retry (RFC 6749
	// §4.1.2.1). The library has no constructor for it.
	temporarilyUnavailable = "temporarily_unavailable"
	// requestURINotSupported refuses a request object passed by reference
	// (RFC 9101 §6.3). The library has no constructor for it.
	requestURINotSupported = "request_uri_not_supported"
	// maxBindingCookies bounds the binding cookies one browser holds. Every
	// accepted request sets one, any site can send a browser here, and the
	// browser sends all of them on every request to the origin.
	maxBindingCookies = 10
)

// AuthRequestStore stores an authorization request with its expiry and
// binding, and returns the nonce the browser's binding cookie holds.
type AuthRequestStore interface {
	Create(ctx context.Context, request *domain.AuthRequest) (bindingNonce string, err error)
}

// answeredErrorKey is the context key of the error an opServer method
// returned, kept for withErrorPages to log with its cause.
type answeredErrorKey struct{}

// errorWriter records an error status and the body the library writes after
// it. With page set it holds both back, so the error page can take their
// place.
type errorWriter struct {
	http.ResponseWriter
	page   bool
	status int
	body   bytes.Buffer
}

// VerifyAuthRequest finds the issuer and the client.
func (s opServer) VerifyAuthRequest(ctx context.Context, r *op.Request[oidc.AuthRequest]) (_ *op.ClientRequest[oidc.AuthRequest], err error) {
	defer func() { keepError(ctx, err) }()
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
	// RFC 6749 §3.1: GET or POST, and no parameter twice. A HEAD would store a
	// request no browser follows, and with a repeated parameter this server
	// and a filter in front of it may each read another value.
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		return nil, op.NewStatusError(oidc.ErrInvalidRequest().WithDescription("the method must be GET or POST"), http.StatusBadRequest)
	}
	for name, values := range r.Form {
		if len(values) > 1 {
			return nil, op.NewStatusError(oidc.ErrInvalidRequest().WithDescription("a parameter is repeated").WithParent(fmt.Errorf("the parameter %.100q is repeated", name)), http.StatusBadRequest)
		}
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
func (s opServer) Authorize(ctx context.Context, r *op.ClientRequest[oidc.AuthRequest]) (_ *op.Redirect, err error) {
	defer func() { keepError(ctx, err) }()
	req := r.Data
	c := r.Client.(*client)
	if err := checkAuthRequest(req, r.Form.Get("request_uri"), c); err != nil {
		return nil, err
	}
	issuer, _ := IssuerFromContext(ctx)
	login, err := loginURL(issuer, r.Header.Get(LoginPathHeader))
	if err != nil {
		return nil, op.NewStatusError(oidc.ErrInvalidRequest().WithDescription("invalid login path").WithParent(err), http.StatusBadRequest)
	}
	request := &domain.AuthRequest{
		ProjectID:   issuer.ProjectID,
		ClientID:    c.id,
		RedirectURI: req.RedirectURI,
		State:       req.State,
		// The server does not serve the standard scopes yet, so they are
		// ignored (ADR 082 §2), and the library drops every other scope.
		// TODO(ADR 082 step 3): keep the scopes the server serves once OpenID
		// Connect ships.
		Scopes:        []string{},
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
	header := http.Header{"Set-Cookie": bindingCookies(issuer, r.Header, request.ID, nonce)}
	return &op.Redirect{URL: login.String(), Header: header}, nil
}

// keepError hands the error an opServer method returns to withErrorPages.
func keepError(ctx context.Context, err error) {
	if kept, ok := ctx.Value(answeredErrorKey{}).(*error); ok && err != nil {
		*kept = err
	}
}

// logError writes the line an error an endpoint answers gets (ADR 030): err
// when an opServer method returned one, or else the library's own refusal,
// read from the status and body it answered with. The library logs both too,
// but without the request id.
func logError(ctx context.Context, err error, status int, body []byte) {
	if err == nil {
		if status == 0 {
			return
		}
		refusal := new(oidc.Error)
		// A body that is not the library's JSON leaves the line without a description.
		_ = json.Unmarshal(body, refusal)
		err = refusal
	}
	if oauthErr, ok := errors.AsType[*oidc.Error](err); !ok || oauthErr.ErrorType == oidc.ServerError || oauthErr.ErrorType == temporarilyUnavailable {
		errlog.LogFault(ctx, err)
		return
	}
	errlog.Log(ctx, domain.ErrRequestInvalid().WithParent(err))
}

// checkAuthRequest refuses what this server cannot serve. The redirect URI
// is valid by now, so each error goes back to the client.
func checkAuthRequest(req *oidc.AuthRequest, requestURI string, c *client) error {
	if req.RequestParam != "" {
		return oidc.ErrRequestNotSupported()
	}
	// The library does not read request_uri, so the request would pass
	// without the object the client meant to send.
	if requestURI != "" {
		return &oidc.Error{ErrorType: requestURINotSupported}
	}
	// With PKCE optional, state is what protects the client from CSRF.
	if req.State == "" {
		return oidc.ErrInvalidRequest().WithDescription("state is required")
	}
	// state is stored, so it must be text every dialect can hold.
	if !storable(req.State) {
		return oidc.ErrInvalidRequest().WithDescription("state must be UTF-8 without NUL")
	}
	if len(req.State) > maxStateBytes {
		return oidc.ErrInvalidRequest().WithDescription("state must be at most %d bytes", maxStateBytes)
	}
	// The metadata offers the query mode only.
	if req.ResponseMode != "" && req.ResponseMode != oidc.ResponseModeQuery {
		return oidc.ErrInvalidRequest().WithDescription("response_mode must be query")
	}
	if !slices.Contains(c.grantTypes, oidc.GrantTypeCode) {
		return oidc.ErrUnauthorizedClient().WithDescription("the client's grant_types do not include authorization_code")
	}
	// Until consent ships, a request may not ask for it (ADR 082, step 2).
	if slices.Contains(req.Prompt, oidc.PromptConsent) {
		return oidc.ErrUnauthorizedClient().WithDescription("consent is not supported yet")
	}
	// Silent sign-in does not exist yet, so a request that forbids a page
	// cannot be answered without one.
	// TODO(#2795): store prompt and decide this on POST /flow (ADR 081 §8).
	if slices.Contains(req.Prompt, oidc.PromptNone) {
		return oidc.ErrInteractionRequired().WithDescription("silent sign-in is not supported yet")
	}
	// A method without a challenge is a client whose PKCE is set up wrong.
	if req.CodeChallenge != "" || req.CodeChallengeMethod != "" {
		// The library reads a missing method as plain; this server accepts S256 only.
		if req.CodeChallengeMethod != oidc.CodeChallengeMethodS256 {
			return oidc.ErrInvalidRequest().WithDescription("code_challenge_method must be S256")
		}
		// The re-encoding check refuses what the decoder lets through: CR/LF and nonzero trailing bits.
		digest, err := base64.RawURLEncoding.DecodeString(req.CodeChallenge)
		if err != nil || len(digest) != sha256.Size || base64.RawURLEncoding.EncodeToString(digest) != req.CodeChallenge {
			return oidc.ErrInvalidRequest().WithDescription("code_challenge must be a base64url SHA-256 digest")
		}
	}
	return nil
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
		return nil, fmt.Errorf("the login path %.200q does not start with a slash", loginPath)
	}
	raw := issuer.Origin() + loginPath
	u, err := httputil.ParseRedirectTarget(raw)
	if err != nil {
		return nil, err
	}
	if u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return nil, fmt.Errorf("the login path %q has a query or fragment", loginPath)
	}
	return u, nil
}

// bindingCookies are the Set-Cookie values of an accepted request. The first
// binds the request's handle to the browser that started it. Each request has
// its own cookie, so a second request in the same browser does not end the
// first (ADR 081 §8.3). The name is `__Host-` prefixed unless the issuer is
// plain http on loopback, where Safari drops Secure cookies (ADR 083). The
// rest expire the oldest binding cookies the browser sent, so it holds at most
// maxBindingCookies.
func bindingCookies(issuer Issuer, sent http.Header, handle, nonce string) []string {
	secure := issuer.URL.Scheme != "http" || !domain.IsLoopbackOrigin(issuer.Origin())
	prefix := "_zauth_"
	if secure {
		prefix = "__Host-" + prefix
	}
	cookie := http.Cookie{
		Name:     prefix + handle,
		Value:    nonce,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		Path:     "/",
		MaxAge:   int(domain.AuthRequestTTL.Seconds()),
	}
	cookies := []string{cookie.String()}
	// A browser sends its cookies oldest first (RFC 6265 §5.4).
	var held []string
	for _, c := range (&http.Request{Header: sent}).Cookies() {
		if strings.HasPrefix(c.Name, prefix) {
			held = append(held, c.Name)
		}
	}
	overLimit := max(len(held)+1-maxBindingCookies, 0)
	for _, name := range held[:overLimit] {
		cookie.Name, cookie.Value, cookie.MaxAge = name, "", -1
		cookies = append(cookies, cookie.String())
	}
	return cookies
}

// withoutLoggedState keeps the client's state out of the log. The library
// logs it with a refusal twice: in the redirect URL and on the error.
func withoutLoggedState(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r.WithContext(zlog.WithoutAttrs(r.Context(), "url", "state")))
	})
}

// withErrorPages answers a browser navigation's error with the error page
// instead of the library's JSON (ADR 076). A program keeps the JSON. The
// Accept header decides, and Vary says so to caches. Either way the error is
// logged once.
func withErrorPages(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Vary", "Accept")
		var answered error
		ew := &errorWriter{ResponseWriter: w, page: errorpage.Wants(r)}
		next.ServeHTTP(ew, r.WithContext(context.WithValue(r.Context(), answeredErrorKey{}, &answered)))
		logError(r.Context(), answered, ew.status, ew.body.Bytes())
		if ew.page && ew.status != 0 {
			body := ew.body.Bytes()
			// The token and revocation endpoints quote the request in their
			// descriptions, so their pages get no sentence.
			if !strings.HasSuffix(r.URL.Path, AuthorizePath) {
				body = nil
			}
			errorpage.Write(w, r, errorPageFor(ew.status, body))
		}
	})
}

func (w *errorWriter) WriteHeader(status int) {
	if status >= http.StatusBadRequest {
		w.status = status
		if w.page {
			return
		}
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *errorWriter) Write(b []byte) (int, error) {
	if w.status != 0 {
		w.body.Write(b)
		if w.page {
			return len(b), nil
		}
	}
	return w.ResponseWriter.Write(b)
}

// errorPageFor builds the error page for status (ADR 076 §4). body is the
// JSON the library answered with, or nil for a page without a sentence. For
// a 4xx the page shows its error_description. In oidc v3.52.0 the
// authorization endpoint's descriptions are fixed texts, and the template
// escapes them.
func errorPageFor(status int, body []byte) errorpage.Page {
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
		var refusal struct {
			Description string `json:"error_description"`
		}
		// A body that is not the library's JSON leaves the page without a sentence.
		_ = json.Unmarshal(body, &refusal)
		return errorpage.Page{Status: status, Title: "Request failed", Description: refusal.Description}
	}
}

// storable reports whether s is text every dialect stores: UTF-8 without NUL.
func storable(s string) bool {
	return utf8.ValidString(s) && !strings.ContainsRune(s, 0)
}
