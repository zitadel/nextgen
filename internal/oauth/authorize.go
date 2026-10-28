package oauth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// sessionCookieName is the console's session cookie (internal/api's
// sessionCookieName), which the platform project's login leaves after the
// widget exchanges its handoff.
const sessionCookieName = "__nextgen_session"

// continuePath is where the console's login page sends the browser once the
// developer signed in: under the console's mount, because the console only
// navigates within itself after a sign-in, and the server's mux routes this
// one path there to the authorization server instead of the console.
const continuePath = "/oauth/continue"

// authorizationRequest is a validated authorization request, sealed while
// the browser signs in and while it shows consent.
type authorizationRequest struct {
	ClientID      string   `json:"client_id"`
	RedirectURI   string   `json:"redirect_uri"`
	State         string   `json:"state,omitempty"`
	CodeChallenge string   `json:"code_challenge"`
	Resource      string   `json:"resource"`
	Scope         []string `json:"scope,omitempty"`
}

// authorize serves GET /oauth/{project}/authorize: it checks the request,
// then signs the developer in through the console's login and asks a
// third-party client's consent before it issues a code.
func (s *Server) authorize(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	// Only a top-level navigation may reach the consent screen, so no script
	// on another page can complete an authorization in the background
	// (ADR 081 §8). Browsers send Fetch Metadata; other clients send none.
	if mode := r.Header.Get("Sec-Fetch-Mode"); mode != "" && mode != "navigate" {
		invalidAuthorizationRequest(w, r)
		return
	}
	q := r.URL.Query()
	client, err := s.resolveClient(ctx, q.Get("client_id"))
	if err != nil {
		if errors.Is(err, errUnknownClient) {
			invalidAuthorizationRequest(w, r)
			return
		}
		authorizationServerFault(w, r, err)
		return
	}
	if len(q["redirect_uri"]) != 1 {
		invalidAuthorizationRequest(w, r)
		return
	}
	redirectURI, ok := matchRedirectURI(client.RedirectURIs, q.Get("redirect_uri"))
	if !ok {
		invalidAuthorizationRequest(w, r)
		return
	}
	// From here on every failure goes back to the client.
	state := q.Get("state")
	fail := func(code, description string) {
		s.redirectError(w, r, redirectURI, state, code, description)
	}
	if q.Get("response_type") != "code" {
		fail(errUnsupportedResponseType, "Only response_type=code is supported.")
		return
	}
	if !validChallenge(q.Get("code_challenge"), q.Get("code_challenge_method")) {
		fail(errInvalidRequest, "PKCE with code_challenge_method=S256 is required.")
		return
	}
	if len(q["resource"]) > 1 {
		fail(errInvalidTarget, "A token is for one API: name one resource.")
		return
	}
	api, ok := s.app.resource(client, q.Get("resource"))
	if !ok {
		fail(errInvalidTarget, "This client may not request that resource.")
		return
	}
	req := authorizationRequest{
		ClientID:      client.ID,
		RedirectURI:   redirectURI.String(),
		State:         state,
		CodeChallenge: q.Get("code_challenge"),
		Resource:      api.Identifier,
		Scope:         grantedScopes(api, strings.Fields(q.Get("scope"))),
	}
	s.proceed(w, r, client, req, q.Get("prompt") == "none")
}

// resume serves the continue path the console's login returns to.
func (s *Server) resume(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req authorizationRequest
	if err := s.unseal(ctx, kindRequest, r.URL.Query().Get("request"), &req); err != nil {
		if errors.Is(err, errSealed) {
			invalidAuthorizationRequest(w, r)
			return
		}
		authorizationServerFault(w, r, err)
		return
	}
	client, err := s.resolveClient(ctx, req.ClientID)
	if err != nil {
		if errors.Is(err, errUnknownClient) {
			invalidAuthorizationRequest(w, r)
			return
		}
		authorizationServerFault(w, r, err)
		return
	}
	// A browser that comes back still without a session gets an error, not
	// another trip to the login.
	s.proceed(w, r, client, req, true)
}

// proceed takes a validated request on: to the login without a session, to
// consent for a third-party client, else straight to a code.
func (s *Server) proceed(w http.ResponseWriter, r *http.Request, client Client, req authorizationRequest, noLogin bool) {
	ctx := r.Context()
	redirectURI, _ := url.Parse(req.RedirectURI)
	user, err := s.sessionUser(r)
	if err != nil {
		authorizationServerFault(w, r, err)
		return
	}
	if user == "" {
		if noLogin {
			s.redirectError(w, r, redirectURI, req.State, errLoginRequired, "Sign-in did not complete.")
			return
		}
		sealed, err := s.seal(ctx, kindRequest, req, requestTTL)
		if err != nil {
			authorizationServerFault(w, r, err)
			return
		}
		http.Redirect(w, r, s.loginURL(sealed), http.StatusSeeOther)
		return
	}
	if !client.FirstParty {
		if r.URL.Query().Get("prompt") == "none" {
			s.redirectError(w, r, redirectURI, req.State, errConsentRequired, "This app needs your consent.")
			return
		}
		s.showConsent(w, r, client, req, user)
		return
	}
	s.issueCode(w, r, req, user)
}

// loginURL is the console's login page, which returns to the continue path
// with the sealed request once the developer signed in.
func (s *Server) loginURL(sealed string) string {
	next := continuePath + "?" + url.Values{"request": {sealed}}.Encode()
	u := *s.publicBase
	u.Path = s.consolePath + "/login"
	u.RawQuery = url.Values{"next": {next}}.Encode()
	return u.String()
}

// sessionUser is the platform-project user the browser's session cookie
// names, or "" when it names none. Only a failure to decide is an error.
func (s *Server) sessionUser(r *http.Request) (string, error) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil || cookie.Value == "" {
		return "", nil
	}
	token, err := s.sessions.IntrospectToken(r.Context(), cookie.Value)
	if err != nil {
		if isRejectedToken(err) {
			return "", nil
		}
		return "", err
	}
	if domain.ValidateSessionToken(token) != nil || token.ProjectID != s.projectID {
		return "", nil
	}
	self, err := domain.SelfFromSession(token, s.now())
	if err != nil {
		return "", nil
	}
	return self.UserID(), nil
}

// isRejectedToken mirrors internal/api's: the errors that mean the cookie is
// no good, as opposed to a store that could not tell.
func isRejectedToken(err error) bool {
	return errors.Is(err, domain.ErrInvalidToken()) ||
		errors.Is(err, domain.ErrInvalidTokenIdentifiers()) ||
		errors.Is(err, domain.ErrTokenRevoked()) ||
		errors.Is(err, domain.ErrEncryptionKeyNotFound())
}

// consentToken binds a consent form to the browser's session and to the
// request it answers: only a holder of the HttpOnly cookie can know it.
func consentToken(cookie, sealedRequest string) string {
	mac := hmac.New(sha256.New, []byte(cookie))
	mac.Write([]byte("oauth-consent\x00" + sealedRequest))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// consentGuard refuses a consent post from another site. The CSRF token is
// the second check (ADR 053 §5's pair).
var consentGuard = http.NewCrossOriginProtection()

// consent serves POST /oauth/{project}/consent: the developer's answer to a
// third-party client's consent screen.
func (s *Server) consent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if err := consentGuard.Check(r); err != nil {
		invalidAuthorizationRequest(w, r)
		return
	}
	if err := r.ParseForm(); err != nil {
		invalidAuthorizationRequest(w, r)
		return
	}
	sealed := r.PostForm.Get("request")
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil || !hmac.Equal([]byte(consentToken(cookie.Value, sealed)), []byte(r.PostForm.Get("csrf"))) {
		invalidAuthorizationRequest(w, r)
		return
	}
	var req authorizationRequest
	if err := s.unseal(ctx, kindRequest, sealed, &req); err != nil {
		if errors.Is(err, errSealed) {
			invalidAuthorizationRequest(w, r)
			return
		}
		authorizationServerFault(w, r, err)
		return
	}
	user, err := s.sessionUser(r)
	if err != nil {
		authorizationServerFault(w, r, err)
		return
	}
	redirectURI, err := url.Parse(req.RedirectURI)
	if err != nil {
		invalidAuthorizationRequest(w, r)
		return
	}
	if user == "" {
		s.redirectError(w, r, redirectURI, req.State, errLoginRequired, "Your session ended.")
		return
	}
	if r.PostForm.Get("decision") != "allow" {
		s.redirectError(w, r, redirectURI, req.State, errAccessDenied, "You did not allow the app.")
		return
	}
	s.issueCode(w, r, req, user)
}

// codePayload is what an authorization code seals.
type codePayload struct {
	GrantID       string   `json:"grant_id"`
	TokenID       string   `json:"token_id"`
	ClientID      string   `json:"client_id"`
	RedirectURI   string   `json:"redirect_uri"`
	CodeChallenge string   `json:"code_challenge"`
	Resource      string   `json:"resource"`
	Scope         []string `json:"scope,omitempty"`
	UserID        string   `json:"user_id"`
}

// issueCode starts a grant and sends the browser to the client with its code,
// the state and the issuer (RFC 9207).
func (s *Server) issueCode(w http.ResponseWriter, r *http.Request, req authorizationRequest, user string) {
	code, err := s.newCode(r.Context(), req, user)
	if err != nil {
		authorizationServerFault(w, r, err)
		return
	}
	target, _ := url.Parse(req.RedirectURI)
	q := target.Query()
	q.Set("code", code)
	if req.State != "" {
		q.Set("state", req.State)
	}
	q.Set("iss", s.issuer)
	target.RawQuery = q.Encode()
	http.Redirect(w, r, target.String(), http.StatusSeeOther)
}

func (s *Server) newCode(ctx context.Context, req authorizationRequest, user string) (string, error) {
	grantID, err := s.grants.NewGrantID()
	if err != nil {
		return "", domain.ErrInternal(err).WithMessage("failed to mint grant id")
	}
	tokenID, err := s.grants.Issue(ctx, service.OAuthGrantToken{
		ProjectID: s.projectID,
		GrantID:   grantID,
		UserID:    user,
		Scope:     req.Scope,
		ExpiresAt: s.now().Add(codeTTL),
	})
	if err != nil {
		return "", err
	}
	return s.seal(ctx, kindCode, codePayload{
		GrantID:       grantID,
		TokenID:       tokenID,
		ClientID:      req.ClientID,
		RedirectURI:   req.RedirectURI,
		CodeChallenge: req.CodeChallenge,
		Resource:      req.Resource,
		Scope:         req.Scope,
		UserID:        user,
	}, codeTTL)
}
