package oauth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// sessionCookieName is the console's session cookie under its canonical name
// (internal/api's sessionCookieName), which the platform project's login
// leaves after the widget exchanges its handoff. Over plain http to a
// loopback host the cookie is zitadel_session, which api.WithLoopbackSessionCookie
// copies to this name before the request gets here.
const sessionCookieName = "__Host-zitadel_session"

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
	// AskConsent is prompt=consent: the consent step comes even when the user
	// consented to every scope already (ADR 082 §8).
	AskConsent bool `json:"ask_consent,omitempty"`
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
	// From here on a failure goes back to the client, where it may go before
	// the user has signed in and seen the app.
	state := q.Get("state")
	fail := func(code, description string) {
		s.failUnasked(w, r, client, redirectURI, state, code, description)
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
		AskConsent:    slices.Contains(strings.Fields(q.Get("prompt")), "consent"),
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

// proceed takes a validated request on: to the login without a session; for a
// third-party client, to the consent step unless the user's consent covers
// every scope it asks for (ADR 082 §8); else straight to a code under the
// user's consent.
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
			s.failUnasked(w, r, client, redirectURI, req.State, errLoginRequired, "Sign-in did not complete.")
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
		consented, err := s.consents.Find(ctx, s.projectID, user, client.ID, req.Resource)
		if err != nil && !errors.Is(err, domain.ErrConsentNotFound()) {
			authorizationServerFault(w, r, err)
			return
		}
		if consented == nil || !consented.Covers(req.Scope) || req.AskConsent {
			if r.URL.Query().Get("prompt") == "none" {
				s.failUnasked(w, r, client, redirectURI, req.State, errConsentRequired, "This app needs your consent.")
				return
			}
			s.showConsent(w, r, client, req, user)
			return
		}
	}
	// A first-party client asks nothing, but its consent is kept all the
	// same: the user sees it among the apps they connected, and revokes it.
	s.consentAndIssueCode(w, r, client, req, user)
}

// failUnasked answers a failure the user has not seen the app's consent for.
// It goes back to a first-party client, or to a loopback URI, the user's own
// machine. A registered client's other URIs are whatever its registration
// said, so sending the browser there unasked would make this server a
// redirector for phishing (RFC 9700 §4.11.2): the error page answers instead.
func (s *Server) failUnasked(w http.ResponseWriter, r *http.Request, client Client, redirectURI *url.URL, state, code, description string) {
	if !client.FirstParty && !isLoopback(redirectURI.Hostname()) {
		invalidAuthorizationRequest(w, r)
		return
	}
	s.redirectError(w, r, redirectURI, state, code, description)
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
	client, err := s.resolveClient(ctx, req.ClientID)
	if err != nil {
		if errors.Is(err, errUnknownClient) {
			invalidAuthorizationRequest(w, r)
			return
		}
		authorizationServerFault(w, r, err)
		return
	}
	s.consentAndIssueCode(w, r, client, req, user)
}

// codePayload is what an authorization code seals.
type codePayload struct {
	ConsentID     string   `json:"consent_id"`
	TokenID       string   `json:"token_id"`
	ClientID      string   `json:"client_id"`
	RedirectURI   string   `json:"redirect_uri"`
	CodeChallenge string   `json:"code_challenge"`
	Resource      string   `json:"resource"`
	Scope         []string `json:"scope,omitempty"`
	UserID        string   `json:"user_id"`
}

// consentAndIssueCode records the user's consent to what the request asks,
// which renews a consent that covered it already, and sends the browser to
// the client with a code issued under it, the state and the issuer
// (RFC 9207).
func (s *Server) consentAndIssueCode(w http.ResponseWriter, r *http.Request, client Client, req authorizationRequest, user string) {
	consent, err := s.consents.Give(r.Context(), service.GiveConsentInput{
		ProjectID:  s.projectID,
		UserID:     user,
		ClientID:   client.ID,
		ClientName: client.Name,
		Resource:   req.Resource,
		Scope:      req.Scope,
	})
	if err != nil {
		authorizationServerFault(w, r, err)
		return
	}
	code, err := s.newCode(r.Context(), req, user, consent.ID)
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

func (s *Server) newCode(ctx context.Context, req authorizationRequest, user, consentID string) (string, error) {
	tokenID, err := s.consents.IssueToken(ctx, service.ConsentToken{
		ProjectID: s.projectID,
		ConsentID: consentID,
		UserID:    user,
		Scope:     req.Scope,
		ExpiresAt: s.now().Add(codeTTL),
	})
	if err != nil {
		return "", err
	}
	return s.seal(ctx, kindCode, codePayload{
		ConsentID:     consentID,
		TokenID:       tokenID,
		ClientID:      req.ClientID,
		RedirectURI:   req.RedirectURI,
		CodeChallenge: req.CodeChallenge,
		Resource:      req.Resource,
		Scope:         req.Scope,
		UserID:        user,
	}, codeTTL)
}
