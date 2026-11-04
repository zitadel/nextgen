package oauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// maxStateLength bounds the state a client sends. The request travels in the
// login flow's sealed cookie (ADR 081 §8), which a browser drops past 4 KiB.
const maxStateLength = 512

// authorizationRequest is a validated authorization request. The login page
// gets it sealed into an opaque handle, and the flow that answers it keeps it
// sealed with its state.
type authorizationRequest struct {
	// ID names the cookie that binds the request to the browser, and Binding
	// is the hash of that cookie's value. Neither is kept with the flow.
	ID      string `json:"id,omitempty"`
	Binding string `json:"binding,omitempty"`
	// ClientID is the flow's client id (domain.FlowClient.ID) once the flow
	// has the request, so the record leaves it out.
	ClientID      string   `json:"client_id,omitempty"`
	RedirectURI   string   `json:"redirect_uri"`
	State         string   `json:"state,omitempty"`
	CodeChallenge string   `json:"code_challenge"`
	Resource      string   `json:"resource"`
	Scope         []string `json:"scope,omitempty"`
	// AskConsent is prompt=consent: the consent step comes even when the user
	// consented to every scope already (ADR 082 §8).
	AskConsent bool `json:"ask_consent,omitempty"`
	// Consent is the client's consent policy.
	Consent domain.ConsentPolicy `json:"consent,omitempty"`
	// ForceLogin is prompt=login, NoInteraction prompt=none.
	ForceLogin    bool `json:"force_login,omitempty"`
	NoInteraction bool `json:"no_interaction,omitempty"`
	// Error is set on a request that failed its checks after its redirect URI
	// was: the login answers it at once with this error (ADR 081 §8).
	Error *authorizationError `json:"error,omitempty"`
}

// authorizationError is an OAuth error for the client (RFC 6749 §4.1.2.1).
type authorizationError struct {
	Code        string `json:"code"`
	Description string `json:"description,omitempty"`
}

// authorize serves GET /oauth/{project}/authorize: it checks the request,
// then hands it to the console's login page, whose flow signs the user in,
// asks a third-party client's consent, and answers the client (ADR 081 §8).
func (s *Server) authorize(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()
	prompts := strings.Fields(q.Get("prompt"))
	noInteraction := slices.Contains(prompts, "none")
	// Only a top-level navigation may lead to the consent step, so no script,
	// on another page or in a frame, can answer a request in the background
	// (ADR 081 §8); prompt=none never shows the step. Browsers send Fetch
	// Metadata; other clients send none.
	if mode := r.Header.Get("Sec-Fetch-Mode"); mode != "" && mode != "navigate" {
		invalidAuthorizationRequest(w, r)
		return
	}
	if dest := r.Header.Get("Sec-Fetch-Dest"); dest != "" && dest != "document" && !noInteraction {
		invalidAuthorizationRequest(w, r)
		return
	}
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
	// From here on a failure goes back to the client, before the user has
	// signed in and seen the app. A registered client's redirect URI is
	// whatever its registration said, so sending the browser there unasked
	// would make this server a redirector for phishing (RFC 9700 §4.11.2): only
	// a first-party client, or a loopback URI, the user's own machine, gets it.
	// It travels through the login page like every answer, which never sends
	// the browser off the issuer itself (ADR 081 §8).
	state := q.Get("state")
	fail := func(code, description string) {
		if !mayFailUnasked(client.FirstParty, redirectURI) {
			invalidAuthorizationRequest(w, r)
			return
		}
		s.handOff(w, r, authorizationRequest{
			ClientID:    client.ID,
			RedirectURI: redirectURI.String(),
			State:       state,
			Error:       &authorizationError{Code: code, Description: description},
		})
	}
	if q.Get("response_type") != "code" {
		fail(errUnsupportedResponseType, "Only response_type=code is supported.")
		return
	}
	if !client.mayUse(domain.GrantAuthorizationCode) {
		fail(errUnauthorizedClient, "This client may not use the authorization code grant.")
		return
	}
	if !validChallenge(q.Get("code_challenge"), q.Get("code_challenge_method")) {
		fail(errInvalidRequest, "PKCE with code_challenge_method=S256 is required.")
		return
	}
	// Without resource a token would be for userinfo only (ADR 082 §5),
	// which this server does not serve.
	if len(q["resource"]) != 1 || q.Get("resource") == "" {
		fail(errInvalidTarget, "A token is for one API: name it as resource (RFC 8707).")
		return
	}
	if noInteraction && len(prompts) > 1 {
		fail(errInvalidRequest, "prompt=none cannot be combined with another prompt.")
		return
	}
	if len(state) > maxStateLength {
		fail(errInvalidRequest, fmt.Sprintf("state is longer than %d bytes.", maxStateLength))
		return
	}
	// Last, since a registered client joins the API's app here for good.
	api, access, err := s.target(ctx, client, q.Get("resource"), true)
	if err != nil {
		authorizationServerFault(w, r, err)
		return
	}
	if !access.Allowed {
		fail(errInvalidTarget, "This client may not request that resource.")
		return
	}
	scope, err := domain.GrantScopes(api, access, strings.Fields(q.Get("scope")))
	if err != nil {
		fail(errInvalidScope, scopeRefusal(err))
		return
	}
	s.handOff(w, r, authorizationRequest{
		ClientID:      client.ID,
		RedirectURI:   redirectURI.String(),
		State:         state,
		CodeChallenge: q.Get("code_challenge"),
		Resource:      api.Identifier,
		Scope:         scope,
		AskConsent:    slices.Contains(prompts, "consent"),
		Consent:       client.Consent,
		ForceLogin:    slices.Contains(prompts, "login"),
		NoInteraction: noInteraction,
	})
}

// scopeRefusal names the scopes domain.GrantScopes refused: ones the API
// does not define, and ones the client may not get.
func scopeRefusal(err error) string {
	var refused domain.Error
	if errors.As(err, &refused) {
		if details, ok := refused.Details.(map[string][]string); ok {
			names := append(slices.Clone(details["unknown"]), details["not_allowed"]...)
			return fmt.Sprintf("This client may not request the scope %s for this API.", strings.Join(names, ", "))
		}
	}
	return "This client may not request a scope it asked for."
}

// handOff sends the browser to the login page with the request sealed into
// an opaque handle, and binds the request to this browser with a cookie only
// it holds: the handle alone starts no flow (ADR 081 §8). A cookie per request
// lets a second request in the same browser leave the first one alone.
func (s *Server) handOff(w http.ResponseWriter, r *http.Request, req authorizationRequest) {
	nonce := rand.Text()
	req.ID = rand.Text()
	req.Binding = bindingHash(nonce)
	handle, err := s.seal(r.Context(), kindRequest, req, requestTTL)
	if err != nil {
		authorizationServerFault(w, r, err)
		return
	}
	secure := s.secureCookies()
	http.SetCookie(w, &http.Cookie{
		Name:     bindingCookieName(req.ID, secure),
		Value:    nonce,
		HttpOnly: true,
		Secure:   secure,
		// Lax, not Strict, as the SSO binding: the login page's own requests
		// carry it either way, and Lax survives a provider's round trip.
		SameSite: http.SameSiteLaxMode,
		Path:     "/",
		MaxAge:   int(requestTTL.Seconds()),
	})
	http.Redirect(w, r, s.loginURL(handle), http.StatusSeeOther)
}

// bindingCookieName names a request's binding cookie. Like the SSO binding,
// it drops the __Host- prefix where an http loopback host drops Secure.
func bindingCookieName(id string, secure bool) string {
	if secure {
		return "__Host-_zauthz_" + id
	}
	return "_zauthz_" + id
}

func bindingHash(nonce string) string {
	sum := sha256.Sum256([]byte("oauth-binding\x00" + nonce))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// secureCookies is whether the issuer's cookies take Secure: everywhere but
// plain http to a loopback host, where Safari refuses Secure cookies.
func (s *Server) secureCookies() bool {
	return !(strings.EqualFold(s.publicBase.Scheme, "http") && isLoopback(s.publicBase.Hostname()))
}

// mayFailUnasked is whether a failure the user has not seen the app's consent
// for may go back to its redirect URI: a first-party client's, or a loopback
// one, the user's own machine (RFC 9700 §4.11.2).
func mayFailUnasked(firstParty bool, redirectURI *url.URL) bool {
	return firstParty || isLoopback(redirectURI.Hostname())
}

// loginURL is the console's login page, whose flow answers the request.
func (s *Server) loginURL(handle string) string {
	u := *s.publicBase
	u.Path = s.consolePath + "/login"
	u.RawQuery = url.Values{"auth_request": {handle}}.Encode()
	return u.String()
}

// ResolveAuthRequest opens the request a login page starts a flow for, by
// the handle in its URL (ADR 081 §8). It answers only in the browser that
// holds the request's binding cookie, and only for this server's project.
func (s *Server) ResolveAuthRequest(ctx context.Context, projectID, handle string, cookie func(name string) (string, bool)) (*domain.FlowAuthRequest, error) {
	if projectID != s.projectID {
		return nil, domain.ErrFlowAuthRequestInvalid()
	}
	var req authorizationRequest
	if err := s.unseal(ctx, kindRequest, handle, &req); err != nil {
		if errors.Is(err, errSealed) {
			return nil, domain.ErrFlowAuthRequestInvalid()
		}
		return nil, err
	}
	cookieName := bindingCookieName(req.ID, s.secureCookies())
	nonce, ok := cookie(cookieName)
	if !ok || subtle.ConstantTimeCompare([]byte(bindingHash(nonce)), []byte(req.Binding)) != 1 {
		return nil, domain.ErrFlowAuthRequestInvalid()
	}
	client, err := s.resolveClient(ctx, req.ClientID)
	if err != nil {
		if errors.Is(err, errUnknownClient) {
			return nil, domain.ErrFlowAuthRequestInvalid()
		}
		return nil, err
	}
	var api domain.AppAPI
	if req.Error == nil {
		var access domain.ClientAPIAccess
		if api, access, err = s.target(ctx, client, req.Resource, false); err != nil {
			return nil, err
		}
		if !access.Allowed {
			return nil, domain.ErrFlowAuthRequestInvalid()
		}
	}
	redirectURI, err := url.Parse(req.RedirectURI)
	if err != nil {
		return nil, domain.ErrFlowAuthRequestInvalid()
	}
	id, scope, forceLogin, noInteraction := req.ID, req.Scope, req.ForceLogin, req.NoInteraction
	// The flow keeps what Answer needs, and nothing twice: its cookie is
	// small, and the client's id is the flow's client.
	req.ID, req.Binding, req.ClientID = "", "", ""
	record, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	clientName := client.Name
	if clientName == "" {
		clientName = redirectURI.Host
	}
	return &domain.FlowAuthRequest{
		ID:            id,
		BindingCookie: cookieName,
		Client: domain.FlowClient{
			ID:           client.ID,
			Name:         clientName,
			RedirectHost: redirectURI.Host,
			FirstParty:   client.FirstParty,
		},
		API:           domain.FlowAPI{Identifier: api.Identifier, Name: api.Name},
		Scope:         scope,
		ForceLogin:    forceLogin,
		NoInteraction: noInteraction,
		Failed:        req.Error != nil,
		Record:        record,
	}, nil
}

// NeedsConsent reports whether the user must be asked before the client gets
// what the request asks for, by the client's consent policy: a third-party
// client unless the user's consent covers every scope it asks for, a client
// whose app says always on every request, and any client on prompt=consent
// (ADR 082 §3, §8).
func (s *Server) NeedsConsent(ctx context.Context, projectID string, req *domain.FlowAuthRequest, userID string) (bool, error) {
	record, err := s.openRecord(projectID, req)
	if err != nil {
		return false, err
	}
	switch {
	case record.AskConsent, record.Consent == domain.ConsentAlways:
		return true, nil
	case record.Consent == domain.ConsentSkip:
		return false, nil
	}
	consented, err := s.consents.Find(ctx, s.projectID, userID, record.ClientID, record.Resource)
	if err != nil && !errors.Is(err, domain.ErrConsentNotFound()) {
		return false, err
	}
	return consented == nil || !consented.Covers(record.Scope), nil
}

// Answer ends the request for the user and returns where the browser goes:
// the client's redirect URI with a code issued under the user's consent, or
// with the error, the state and the issuer (RFC 9207).
func (s *Server) Answer(ctx context.Context, projectID string, req *domain.FlowAuthRequest, userID string, answer domain.FlowAuthAnswer) (string, error) {
	record, err := s.openRecord(projectID, req)
	if err != nil {
		return "", err
	}
	redirectURI, err := url.Parse(record.RedirectURI)
	if err != nil {
		return "", domain.ErrFlowAuthRequestInvalid()
	}
	if record.Error != nil {
		// Authorize already held it to a client that may get it unasked.
		return s.errorRedirectURL(redirectURI, record.State, record.Error.Code, record.Error.Description), nil
	}
	switch answer {
	case domain.FlowAuthAllow:
		return s.consentAndIssueCode(ctx, record, req.Client.Name, userID)
	case domain.FlowAuthDeny:
		// The user saw the client on the consent step and refused it.
		return s.errorRedirectURL(redirectURI, record.State, errAccessDenied, "You did not allow the app."), nil
	case domain.FlowAuthLoginRequired, domain.FlowAuthConsentRequired:
		if !mayFailUnasked(req.Client.FirstParty, redirectURI) {
			return "", domain.ErrFlowAuthRequestInvalid()
		}
		if answer == domain.FlowAuthLoginRequired {
			return s.errorRedirectURL(redirectURI, record.State, errLoginRequired, "No one is signed in."), nil
		}
		return s.errorRedirectURL(redirectURI, record.State, errConsentRequired, "This app needs your consent."), nil
	}
	return "", fmt.Errorf("oauth: unknown answer %d", answer)
}

// openRecord reads back the request a flow carries, which the server sealed
// with the flow's state.
func (s *Server) openRecord(projectID string, req *domain.FlowAuthRequest) (authorizationRequest, error) {
	var record authorizationRequest
	if projectID != s.projectID || req == nil {
		return record, domain.ErrFlowAuthRequestInvalid()
	}
	if err := json.Unmarshal(req.Record, &record); err != nil {
		return record, fmt.Errorf("oauth: flow's authorization request: %w", err)
	}
	record.ClientID = req.Client.ID
	return record, nil
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
// which renews a consent that covered it already, and returns the client's
// redirect URI with a code issued under it, the state and the issuer
// (RFC 9207).
func (s *Server) consentAndIssueCode(ctx context.Context, req authorizationRequest, clientName, user string) (string, error) {
	consent, err := s.consents.Give(ctx, service.GiveConsentInput{
		ProjectID:  s.projectID,
		UserID:     user,
		ClientID:   req.ClientID,
		ClientName: clientName,
		Resource:   req.Resource,
		Scope:      req.Scope,
	})
	if err != nil {
		return "", err
	}
	code, err := s.newCode(ctx, req, user, consent.ID)
	if err != nil {
		return "", err
	}
	target, err := url.Parse(req.RedirectURI)
	if err != nil {
		return "", domain.ErrFlowAuthRequestInvalid()
	}
	q := target.Query()
	q.Set("code", code)
	if req.State != "" {
		q.Set("state", req.State)
	}
	q.Set("iss", s.issuer)
	target.RawQuery = q.Encode()
	return target.String(), nil
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
