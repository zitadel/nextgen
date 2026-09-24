package api

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// This file is a stub for the external sign-in half of the flow engine, so the
// CLI and the login components can be driven end to end against a local server
// before the real implementation lands (#1030–#1041, #1032). It is deliberately
// the whole implementation, in one file, so replacing it is a deletion.
//
// What it is not: the authorization request is not PKCE-protected, the nonce is
// not checked, and the id_token's signature is NOT verified — the claims are
// read from its payload, so `iss` and `aud` are not checked either. Pending
// authorizations live in this process's memory, so they do not survive a
// restart and are not shared between replicas. No identity link is recorded,
// so every returning identity looks new. The connection's `client_secret` is
// posted as stored, which means the `${{ NAME }}` reference reaches the
// provider verbatim: resolving it against the environment's variables is the
// engine's, and until then only a provider that ignores the secret (a local
// mock) completes the exchange. None of that is acceptable in the real
// engine; all of it is enough to prove the round trip the CLI configures.

// ssoBindingCookie carries a nonce that ties a callback to the browser that
// started the authorization. It is SameSite=Lax deliberately: the callback is
// a cross-site navigation back from the provider, which a Strict cookie would
// not be sent with — the flow cookie's own Strict setting is exactly why the
// state has to be held server-side in the first place.
const ssoBindingCookie = "_zsso"

// maxPendingSSO caps the authorization requests held at once. `POST /flow` is
// unauthenticated, so without a cap a loop of create-flow/submit-sso grows the
// map at request rate, and the sweep below would scan more of it on every
// insert.
const maxPendingSSO = 10_000

// ssoPendingTTL bounds how long an authorization may sit unredeemed, and how
// long the binding cookie lives.
const ssoPendingTTL = 10 * time.Minute

// ssoPending is one authorization request waiting for its callback.
type ssoPending struct {
	// sealedState is the flow cookie's payload, captured at authorize time.
	// The callback arrives as a cross-site navigation and the flow cookie is
	// SameSite=Strict, so the browser will not send it back — the server has
	// to hold the state itself. The real engine needs a deliberate answer
	// here (a Lax callback cookie, or a handle in the redirect URI).
	sealedState string
	projectID   string
	flowID      string
	connection  api.IdpConnection
	// returnURL is where the browser is sent once the flow has advanced: the
	// page that started the sign-in.
	returnURL string
	createdAt time.Time
	// binding is the nonce the browser must present. Without it anyone who
	// learns a `state` can redeem a callback in someone else's browser and
	// plant their own half-finished flow there (login CSRF).
	binding string
}

type ssoStubStore struct {
	mu      sync.Mutex
	pending map[string]ssoPending
}

func newSsoStubStore() *ssoStubStore {
	return &ssoStubStore{pending: map[string]ssoPending{}}
}

// put records a pending authorization and returns its `state` parameter.
func (s *ssoStubStore) put(p ssoPending) (string, error) {
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	state := base64.RawURLEncoding.EncodeToString(raw)
	s.mu.Lock()
	defer s.mu.Unlock()
	// Opportunistic sweep: a browser that never comes back would otherwise
	// leave its entry behind for the life of the process.
	for key, entry := range s.pending {
		if time.Since(entry.createdAt) > ssoPendingTTL {
			delete(s.pending, key)
		}
	}
	if len(s.pending) >= maxPendingSSO {
		return "", fmt.Errorf("too many authorization requests in flight")
	}
	s.pending[state] = p
	return state, nil
}

// peek reads a pending authorization without consuming it, so a caller can
// check the browser binding first. A callback that fails that check must not
// burn the entry: anyone who learned a `state` could otherwise cancel the
// sign-in it belongs to.
func (s *ssoStubStore) peek(state string) (ssoPending, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.pending[state]
	return p, ok
}

// consume retires a `state` so it can be redeemed only once.
func (s *ssoStubStore) consume(state string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.pending, state)
}

// ssoAuthorizeStep answers `action: "sso"` with the step that sends the browser
// to the provider. Returns nil when the submission is not an SSO one, so the
// caller falls through to the ordinary pipeline.
// Returns the step and the `Set-Cookie` value that binds the callback to this
// browser. The flow state is unchanged by the authorize leg — it is held in
// the pending record instead — so the response's one cookie slot carries the
// binding rather than a re-sealed flow cookie.
func (h *Handler) ssoAuthorizeStep(ctx context.Context, state *domain.FlowState, providerID string, origin string) (*domain.FlowStep, string, error) {
	// The step has to offer this provider: without the check, the reserved
	// action would start an external sign-in from any step of any flow, which
	// is a lateral move out of, say, a second-factor step.
	if !h.stepOffersProvider(ctx, state, providerID) {
		return nil, "", domain.ErrIDPConnectionNotFound()
	}
	record, ok := h.idpStub.getBySlug(state.ProjectID, providerID)
	if !ok {
		return nil, "", domain.ErrIDPConnectionNotFound()
	}
	oidc, ok := record.definition.Oidc.Get()
	if !ok {
		return nil, "", domain.ErrRequestInvalid().WithMessage("only oidc connections can be used to sign in")
	}
	sealed, err := h.sealState(ctx, state)
	if err != nil {
		return nil, "", err
	}
	binding, err := randomToken()
	if err != nil {
		return nil, "", domain.ErrInternal(err)
	}
	returnURL := strings.TrimSuffix(origin, "/")
	callback := returnURL + IdpCallbackPath
	stateParam, err := h.ssoStub.put(ssoPending{
		sealedState: sealed,
		projectID:   state.ProjectID,
		flowID:      state.ID,
		connection:  record.definition,
		returnURL:   returnURL,
		createdAt:   time.Now(),
		binding:     binding,
	})
	if err != nil {
		return nil, "", domain.ErrInternal(err)
	}

	authorize, err := authorizeEndpoint(oidc)
	if err != nil {
		return nil, "", domain.ErrRequestInvalid().WithMessage(err.Error())
	}
	query := authorize.Query()
	query.Set("client_id", oidc.ClientID)
	query.Set("redirect_uri", callback)
	query.Set("response_type", "code")
	query.Set("scope", strings.Join(scopesOrDefault(oidc), " "))
	query.Set("state", stateParam)
	authorize.RawQuery = query.Encode()
	target := authorize.String()

	// A step with only a redirect: the client navigates away, so nothing on it
	// is ever painted.
	cookie := (&http.Cookie{
		Name:     ssoBindingCookie,
		Value:    binding,
		Path:     "/",
		HttpOnly: true,
		Secure:   cookieSecureFromContext(ctx),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(ssoPendingTTL.Seconds()),
	}).String()

	return &domain.FlowStep{
		Name:        "sso-redirect",
		Texts:       domain.FlowStepTexts{TitleKey: "sso.redirect.title"},
		RedirectURL: &target,
	}, cookie, nil
}

// randomToken returns a URL-safe 192-bit token.
func randomToken() (string, error) {
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

// stepOffersProvider reports whether the step the flow is currently on lists
// this connection's slug.
//
// Without it the reserved action would start an external sign-in from any step
// of any flow — a lateral move out of, say, a second-factor step, into one the
// definition never routed to. `flowService.Submit` makes the equivalent check
// for every other action; this branch bypasses it, so it makes its own.
func (h *Handler) stepOffersProvider(ctx context.Context, state *domain.FlowState, slug string) bool {
	def, err := h.flowDefinitionService.Get(ctx, state.ProjectID, state.DefinitionID)
	if err != nil || def == nil {
		return false
	}
	step, ok := def.FindStep(state.CurrentStep)
	if !ok {
		return false
	}
	return slices.Contains(step.SSOProviders, slug)
}

// IdpCallbackPath is the redirect URI registered with the vendor, on the app's
// own origin — the same value the CLI prints during `sso enable`.
//
// It pins the SDKs' default proxy prefix. An app that sets its own `proxyPath`
// would register a URI its proxy never serves and see `redirect_uri_mismatch`
// at the provider; deriving this from the project's configured prefix is the
// real implementation's to do.
const IdpCallbackPath = "/__nextgen/idp/callback"

// IdpCallbackRoute is where that request lands on this server. The app's proxy
// strips its own prefix before forwarding (see `proxyRequest` in the Next
// SDK's middleware), so the server serves the remainder.
const IdpCallbackRoute = "/idp/callback"

// IdpCallbackHandler serves the provider's return leg. Stub: see the note at
// the top of this file.
func (h *Handler) IdpCallbackHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		// No-store on a response that carries a Set-Cookie for the flow: a
		// shared cache keyed on this URL would otherwise hand one user's flow
		// to the next. Same-origin is the default referrer policy, which
		// would leak the code and state in the Referer of everything the
		// redirect target loads.
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")

		stateParam := r.URL.Query().Get("state")
		pending, ok := h.ssoStub.peek(stateParam)
		if !ok {
			http.Error(w, "unknown or already used sso state", http.StatusBadRequest)
			return
		}
		// The browser must present the nonce it was given when the
		// authorization started. Without this anyone who learns a `state` can
		// redeem the callback in someone else's browser and plant their own
		// half-finished flow there.
		binding, err := r.Cookie(ssoBindingCookie)
		if err != nil || subtle.ConstantTimeCompare([]byte(binding.Value), []byte(pending.binding)) != 1 {
			// Deliberately before `consume`: a wrong binding leaves the
			// authorization redeemable by the browser it belongs to.
			http.Error(w, "sso callback did not come from the browser that started it", http.StatusBadRequest)
			return
		}
		h.ssoStub.consume(stateParam)
		// Redeemed: retire the binding so it cannot be replayed.
		http.SetCookie(w, &http.Cookie{
			Name: ssoBindingCookie, Value: "", Path: "/", HttpOnly: true,
			Secure: cookieSecureFromContext(ctx), SameSite: http.SameSiteLaxMode, MaxAge: -1,
		})
		if errParam := r.URL.Query().Get("error"); errParam != "" {
			// The user declined at the provider, or it refused. Put them back
			// on the step they started from rather than on an error page.
			h.finishSsoCallback(ctx, w, r, pending, ssoClaims{})
			return
		}
		code := r.URL.Query().Get("code")
		if code == "" {
			http.Error(w, "sso callback without a code", http.StatusBadRequest)
			return
		}
		claims, err := h.exchangeSsoCode(ctx, pending, code)
		if err != nil {
			slog.ErrorContext(ctx, "sso stub: code exchange failed", slog.String("error", err.Error()))
			http.Error(w, "sso code exchange failed", http.StatusBadGateway)
			return
		}
		h.finishSsoCallback(ctx, w, r, pending, claims)
	})
}

// finishSsoCallback advances the flow to the step the outcome calls for and
// sends the browser back to the page that started the sign-in.
func (h *Handler) finishSsoCallback(ctx context.Context, w http.ResponseWriter, r *http.Request, pending ssoPending, claims ssoClaims) {
	state, err := h.openState(ctx, pending.sealedState)
	if err != nil {
		http.Error(w, "sso callback for an expired flow", http.StatusBadRequest)
		return
	}
	if claims.Email != "" {
		// The provider supplied the identifier, so whatever happens next --
		// creation or collection -- works from the claim rather than asking
		// for it again. An unverified one is still prefilled: the user sees
		// it in the field and confirms it, which is what "treated as
		// user-typed" means.
		if state.CollectedData.UserData == nil {
			state.CollectedData.UserData = map[string]any{}
		}
		state.CollectedData.UserData["email"] = claims.Email
	}
	if err := h.resolveSsoIdentity(ctx, state, pending, claims); err != nil {
		slog.ErrorContext(ctx, "sso stub: resolving the identity failed", slog.String("error", err.Error()))
		http.Error(w, "sso callback could not resume the flow", http.StatusInternalServerError)
		return
	}
	sealed, err := h.sealState(ctx, state)
	if err != nil {
		http.Error(w, "sso callback could not resume the flow", http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     flowCookieName,
		Value:    sealed,
		Path:     "/",
		HttpOnly: true,
		// The same rule every other cookie here follows: honours
		// X-Forwarded-Proto and fails closed, so TLS terminated at a proxy
		// still yields a Secure cookie.
		Secure: cookieSecureFromContext(ctx),
		// Lax, not Strict: the browser is arriving from the provider, and a
		// Strict cookie set here would not be sent with the redirect that
		// follows. The real engine has to make this decision deliberately.
		SameSite: http.SameSiteLaxMode,
		MaxAge:   flowCookieMaxAgeSeconds,
	})
	// The flow handle rides in the query so the page can resume rather than
	// start a new flow: `<zitadel-login resume-flow-id>` reads it and calls
	// `GET /flow/{id}` with the cookie set above.
	http.Redirect(w, r, pending.returnURL+"/login?flow="+url.QueryEscape(state.ID), http.StatusFound)
}

// resolveSsoIdentity fires the outcome the callback resolved to and lets the
// flow definition route it, which is what [domain.FlowResumeWithOutcome] is
// for: the purpose flip that `identity_unknown` carries is part of the
// outcome's meaning, and a caller that assigns the next step itself loses it.
//
// The three outcomes are area 3's
// ([docs/design/idp/3-social-login-flow.md](../../docs/design/idp/3-social-login-flow.md)):
//
//   - `callback` -- the subject is signed in. This stub stores no identity
//     link (#1033), so it never recognises a *returning* subject; it reaches
//     this outcome only the other way, by creating the account here and now
//     under `provisioning.creation: auto`.
//   - `identity_unknown` -- the account could not be created from the claims
//     alone, so the flow stops at the collection step, prefilled.
//   - `user_already_exists` -- the claims collide with an account that is
//     already there, which the definition routes to the conflict step.
//
// A provider the user declined leaves the flow exactly where it was.
func (h *Handler) resolveSsoIdentity(
	ctx context.Context,
	state *domain.FlowState,
	pending ssoPending,
	claims ssoClaims,
) error {
	if claims.Email == "" {
		// Declined at the provider: no outcome fired, so nothing advances.
		// Refreshing the clock is still right -- the user was away a while.
		state.IssuedAt = time.Now().UTC()
		return nil
	}
	def, err := h.flowDefinitionService.Get(ctx, state.ProjectID, state.DefinitionID)
	if err != nil {
		return fmt.Errorf("sso callback: load definition: %w", err)
	}
	outcome, created := h.ssoOutcome(ctx, state, pending, claims)
	result, err := h.flowStateMachine.ResumeWithOutcome(ctx, def, state, outcome, created)
	if err != nil {
		if errors.Is(err, domain.ErrFlowIntegrity()) {
			// A definition that offers a provider on a step but does not say
			// where its answers go is a scaffolding bug, not a user error;
			// leaving the flow where it stands is the only safe answer.
			slog.WarnContext(ctx, "sso stub: definition does not route the outcome",
				slog.String("outcome", outcome), slog.String("step", state.CurrentStep))
			state.IssuedAt = time.Now().UTC()
			return nil
		}
		return fmt.Errorf("sso callback: resume: %w", err)
	}
	if result.HandoffToken != "" && result.Step != nil && result.Step.Complete != nil {
		// The flow finished while the browser was at the provider. The token
		// cannot ride the redirect, so it waits in the sealed cookie for the
		// GET the page makes on its way back (see FlowPendingHandoff).
		state.PendingHandoff = &domain.FlowPendingHandoff{
			Token:     result.HandoffToken,
			ExpiresAt: result.HandoffTokenExpiresAt,
			Complete:  *result.Step.Complete,
		}
	}
	return nil
}

// ssoOutcome decides which of the three resolution outcomes fired.
//
// Under `provisioning.creation: auto` -- the catalog default, and what the
// CLI writes -- the account is created here, from the claims, and the user is
// signed in without being stopped for anything the provider already answered.
// The completeness test is the creation itself: the schema decides what a
// user needs, so attempting it and degrading on failure asks the schema
// rather than re-deriving its required list here.
// The second return says whether an account was created, which the resume
// treats as irreversible: the user cannot go back past it.
func (h *Handler) ssoOutcome(
	ctx context.Context,
	state *domain.FlowState,
	pending ssoPending,
	claims ssoClaims,
) (string, bool) {
	if h.ssoCreationMode(pending) != api.IdpConnectionProvisioningCreationAuto || h.ssoUserCreater == nil {
		return domain.FlowImplicitOutcomeIdentityUnknown, false
	}
	if !claims.Verified {
		// The identifier is the schema's unique property, and an unverified
		// one may not skip collection: provisioning on it would let anyone
		// who can type a victim's address into a provider claim their
		// account before they ever sign up.
		return domain.FlowImplicitOutcomeIdentityUnknown, false
	}
	result, err := h.ssoUserCreater.Handle(ctx, domain.FlowOnSuccessInput{
		ProjectID:     state.ProjectID,
		UserSchemaURL: state.UserSchemaURL,
		State:         state,
	})
	switch {
	case err != nil:
		// Incomplete claims fail schema validation here, which is the
		// documented fallback: show the collection step, prefilled with what
		// did arrive. An infrastructure failure lands in the same place, so
		// it is logged rather than swallowed -- the user gets a form instead
		// of a 500, and the operator gets the cause.
		slog.WarnContext(ctx, "sso stub: creating from claims failed, collecting instead",
			slog.String("error", err.Error()))
		return domain.FlowImplicitOutcomeIdentityUnknown, false
	case result.StepError != nil && *result.StepError == domain.FlowImplicitOutcomeUserAlreadyExists:
		return domain.FlowImplicitOutcomeUserAlreadyExists, false
	case result.StepError != nil:
		return domain.FlowImplicitOutcomeIdentityUnknown, false
	}
	if result.UserID != "" {
		state.CollectedData.UserID = result.UserID
	}
	return ssoCallbackOutcome, true
}

// ssoCallbackOutcome is the shipped outcome for a resolved identity.
const ssoCallbackOutcome = "callback"

// ssoCreationMode reads the connection's provisioning policy, defaulting to
// the schema's own default rather than to the most restrictive value: a
// connection that omits the block means "auto", and treating it as disabled
// would stop every new user at a step the scaffold may not even contain.
func (h *Handler) ssoCreationMode(pending ssoPending) api.IdpConnectionProvisioningCreation {
	provisioning, ok := pending.connection.Provisioning.Get()
	if !ok {
		return api.IdpConnectionProvisioningCreationAuto
	}
	creation, ok := provisioning.Creation.Get()
	if !ok {
		return api.IdpConnectionProvisioningCreationAuto
	}
	return creation
}

// flowStepExists reports whether the running definition declares a step.
func (h *Handler) flowStepExists(ctx context.Context, state *domain.FlowState, name string) bool {
	def, err := h.flowDefinitionService.Get(ctx, state.ProjectID, state.DefinitionID)
	if err != nil || def == nil {
		return false
	}
	_, ok := def.FindStep(name)
	return ok
}

// exchangeSsoCode swaps the authorization code for tokens and reads the email
// claim. Stub: the id_token's signature is not verified.
func (h *Handler) exchangeSsoCode(ctx context.Context, pending ssoPending, code string) (ssoClaims, error) {
	oidc, _ := pending.connection.Oidc.Get()
	tokenURL, err := tokenEndpoint(oidc)
	if err != nil {
		return ssoClaims{}, err
	}
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", pending.returnURL+IdpCallbackPath)
	form.Set("client_id", oidc.ClientID)
	// The schema's default is client_secret_basic, so a connection that omits
	// the field expects the header form. Posting the secret in the body
	// regardless is rejected by any provider that enforces basic auth.
	basic := oidc.TokenEndpointAuthMethod.Or(api.IdpConnectionOidcTokenEndpointAuthMethodClientSecretBasic) ==
		api.IdpConnectionOidcTokenEndpointAuthMethodClientSecretBasic
	if !basic {
		form.Set("client_secret", oidc.ClientSecret)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return ssoClaims{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if basic {
		req.SetBasicAuth(url.QueryEscape(oidc.ClientID), url.QueryEscape(oidc.ClientSecret))
	}
	if h.ssoEgress == nil {
		return ssoClaims{}, fmt.Errorf("no egress client configured for the token exchange")
	}
	resp, err := h.ssoEgress.Do(req)
	if err != nil {
		return ssoClaims{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return ssoClaims{}, err
	}
	if resp.StatusCode != http.StatusOK {
		// OAuth error bodies (invalid_client, invalid_grant) are the entire
		// diagnostic here, and this stub's most likely failure — an
		// unresolved `${{ VAR }}` client secret — reports exactly that way.
		return ssoClaims{}, fmt.Errorf("token endpoint answered %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var tokens struct {
		IDToken string `json:"id_token"`
	}
	if err := json.Unmarshal(body, &tokens); err != nil {
		return ssoClaims{}, err
	}
	if tokens.IDToken == "" {
		return ssoClaims{}, fmt.Errorf("token response carried no id_token")
	}
	return emailClaim(tokens.IDToken)
}

// ssoClaims is what the stub reads out of an id_token: the identifier and
// whether the provider says it checked it.
type ssoClaims struct {
	Email string
	// Verified follows the connection's `verified_claims` rule for the
	// identifier. Unverified is not a failure -- it decides whether the
	// claim may skip collection, not whether the sign-in may proceed.
	Verified bool
}

// emailClaim reads the email out of an id_token's payload WITHOUT verifying
// its signature. Stub only.
//
// An unverified address is returned rather than refused. The design's rule is
// that it degrades the attempt to collection and is treated as user-typed
// (area 3, Creation Without Collection): the user still gets to sign up, but
// the provider's word alone does not provision an account on an address
// anyone could have typed into it, which is the account-takeover this gate
// exists to stop. Refusing outright would instead strand a legitimate user
// on the entry step with nothing to do.
func emailClaim(idToken string) (ssoClaims, error) {
	parts := strings.Split(idToken, ".")
	if len(parts) < 2 {
		return ssoClaims{}, fmt.Errorf("id_token is not a JWT")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ssoClaims{}, err
	}
	var claims struct {
		Email string `json:"email"`
		// Providers disagree on the shape: some send a boolean, some the
		// string "true". Decoding into `any` reads either without the whole
		// token failing on the surprise, which is the difference between
		// "we do not trust this address" and "we cannot sign this user in".
		Verified any   `json:"email_verified"`
		Expiry   int64 `json:"exp"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return ssoClaims{}, err
	}
	if claims.Email == "" {
		return ssoClaims{}, fmt.Errorf("id_token carried no email claim")
	}
	if claims.Expiry > 0 && time.Now().After(time.Unix(claims.Expiry, 0)) {
		return ssoClaims{}, fmt.Errorf("id_token has expired")
	}
	return ssoClaims{Email: claims.Email, Verified: claimIsTrue(claims.Verified)}, nil
}

// claimIsTrue evaluates a verification claim: strictly boolean true, or the
// string "true". Anything else -- another string, a number, a missing claim
// -- is unverified, rather than an error. A provider that answers something
// unrecognised has not told us the address is checked, which is all this
// needs to decide.
func claimIsTrue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return typed == "true"
	default:
		return false
	}
}

// authorizeEndpoint prefers the connection's explicit endpoint and otherwise
// derives one from the issuer, which is what a discovery document would give.
func authorizeEndpoint(oidc api.IdpConnectionOidc) (*url.URL, error) {
	if explicit, ok := oidc.AuthorizationEndpoint.Get(); ok && explicit != "" {
		return checkedEndpoint(explicit)
	}
	if oidc.Issuer == "" {
		return nil, fmt.Errorf("connection has no issuer")
	}
	return checkedEndpoint(strings.TrimSuffix(oidc.Issuer, "/") + "/authorize")
}

func tokenEndpoint(oidc api.IdpConnectionOidc) (string, error) {
	raw := strings.TrimSuffix(oidc.Issuer, "/") + "/token"
	if explicit, ok := oidc.TokenEndpoint.Get(); ok && explicit != "" {
		raw = explicit
	} else if oidc.Issuer == "" {
		return "", fmt.Errorf("connection has no issuer")
	}
	parsed, err := checkedEndpoint(raw)
	if err != nil {
		return "", err
	}
	return parsed.String(), nil
}

// checkedEndpoint holds a connection's endpoint to the schema's own rule:
// https, or http on loopback for local development (`idp-connection.yaml`).
// The stub stores documents without validating them, so without this a
// `javascript:` authorization endpoint would reach the browser as a step's
// redirect_url, and a token endpoint could name any scheme at all.
func checkedEndpoint(raw string) (*url.URL, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	switch {
	case parsed.Scheme == "https":
		return parsed, nil
	case parsed.Scheme == "http" && isLoopbackHost(parsed.Hostname()):
		return parsed, nil
	default:
		return nil, fmt.Errorf("endpoint %q must be https, or http on loopback", raw)
	}
}

func scopesOrDefault(oidc api.IdpConnectionOidc) []string {
	if len(oidc.Scopes) > 0 {
		return oidc.Scopes
	}
	return []string{"openid", "profile", "email"}
}

// resolveSsoProviders turns the slugs a rendered step carries into the
// {id, name, template} entries the login components draw buttons from.
//
// Stub: the engine renders slugs only (see ssoProvidersFromSlugs), and looking
// each one up in the identity layer is #1031's job. A slug with no connection
// is dropped rather than shown — a button that cannot start a sign-in is worse
// than no button.
func (h *Handler) resolveSsoProviders(projectID string, step *domain.FlowStep) []api.SSOProvider {
	if step == nil || len(step.SSOProviders) == 0 {
		return nil
	}
	out := make([]api.SSOProvider, 0, len(step.SSOProviders))
	for _, provider := range step.SSOProviders {
		record, ok := h.idpStub.getBySlug(projectID, provider.ID)
		if !ok {
			continue
		}
		name := record.definition.DisplayName
		if name == "" {
			name = record.slug
		}
		template := record.definition.Template.Or("")
		// The slug, not the connection id: `sso-provider.yaml` documents this
		// field with the example `google`, and it is the value the client
		// sends back as `sso_provider_id`, which is looked up by slug.
		out = append(out, api.SSOProvider{ID: record.slug, Name: name, Template: template})
	}
	return out
}
