package api

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
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
// read from its payload. Pending authorizations live in this process's memory,
// so they do not survive a restart and are not shared between replicas. No
// identity link is recorded, so a returning user is matched on the email claim
// alone. None of that is acceptable in the real engine; all of it is enough to
// prove the round trip the CLI configures actually works.

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
		if time.Since(entry.createdAt) > 10*time.Minute {
			delete(s.pending, key)
		}
	}
	s.pending[state] = p
	return state, nil
}

// take consumes a pending authorization. A `state` can be redeemed once, so a
// replayed callback finds nothing.
func (s *ssoStubStore) take(state string) (ssoPending, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.pending[state]
	delete(s.pending, state)
	return p, ok
}

// ssoAuthorizeStep answers `action: "sso"` with the step that sends the browser
// to the provider. Returns nil when the submission is not an SSO one, so the
// caller falls through to the ordinary pipeline.
func (h *Handler) ssoAuthorizeStep(ctx context.Context, state *domain.FlowState, providerID string, origin string) (*domain.FlowStep, error) {
	record, ok := h.idpStub.get(state.ProjectID, providerID)
	if !ok {
		return nil, domain.ErrIDPConnectionNotFound()
	}
	oidc, ok := record.definition.Oidc.Get()
	if !ok {
		return nil, domain.ErrRequestInvalid().WithMessage("only oidc connections can be used to sign in")
	}
	sealed, err := h.sealState(ctx, state)
	if err != nil {
		return nil, err
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
	})
	if err != nil {
		return nil, domain.ErrInternal(err)
	}

	authorize, err := authorizeEndpoint(oidc)
	if err != nil {
		return nil, domain.ErrRequestInvalid().WithMessage(err.Error())
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
	return &domain.FlowStep{
		Name:        "sso-redirect",
		Texts:       domain.FlowStepTexts{TitleKey: "sso.redirect.title"},
		RedirectURL: &target,
	}, nil
}

// IdpCallbackPath is the redirect URI registered with the vendor, on the app's
// own origin — the same value the CLI prints during `sso enable`.
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
		pending, ok := h.ssoStub.take(r.URL.Query().Get("state"))
		if !ok {
			http.Error(w, "unknown or already used sso state", http.StatusBadRequest)
			return
		}
		if errParam := r.URL.Query().Get("error"); errParam != "" {
			// The user declined at the provider, or it refused. Put them back
			// on the step they started from rather than on an error page.
			h.finishSsoCallback(ctx, w, r, pending, "")
			return
		}
		code := r.URL.Query().Get("code")
		if code == "" {
			http.Error(w, "sso callback without a code", http.StatusBadRequest)
			return
		}
		email, err := h.exchangeSsoCode(ctx, pending, code)
		if err != nil {
			slog.ErrorContext(ctx, "sso stub: code exchange failed", slog.String("error", err.Error()))
			http.Error(w, "sso code exchange failed", http.StatusBadGateway)
			return
		}
		h.finishSsoCallback(ctx, w, r, pending, email)
	})
}

// finishSsoCallback advances the flow to the step the outcome calls for and
// sends the browser back to the page that started the sign-in.
func (h *Handler) finishSsoCallback(ctx context.Context, w http.ResponseWriter, r *http.Request, pending ssoPending, email string) {
	state, err := h.openState(ctx, pending.sealedState)
	if err != nil {
		http.Error(w, "sso callback for an expired flow", http.StatusBadRequest)
		return
	}
	target := h.ssoOutcomeStep(ctx, state, email)
	state.CurrentStep = target
	if email != "" {
		// The provider supplied the identifier, so the step the flow resumes
		// on does not have to ask for it again.
		if state.CollectedData.UserData == nil {
			state.CollectedData.UserData = map[string]any{}
		}
		state.CollectedData.UserData["email"] = email
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
		Secure:   r.TLS != nil,
		// Lax, not Strict: the browser is arriving from the provider, and a
		// Strict cookie set here would not be sent with the redirect that
		// follows. The real engine has to make this decision deliberately.
		SameSite: http.SameSiteLaxMode,
	})
	// The flow handle rides in the query so the page can resume rather than
	// start a new flow: `<zitadel-login resume-flow-id>` reads it and calls
	// `GET /flow/{id}` with the cookie set above.
	http.Redirect(w, r, pending.returnURL+"/login?flow="+url.QueryEscape(state.ID), http.StatusFound)
}

// ssoOutcomeStep picks the step the flow resumes on.
//
// Always `register-sso` on a successful return, because this stub records no
// identity link: every returning identity is one it has never seen, which is
// the engine's `identity_unknown` outcome. The other two outcomes are reached
// from there rather than decided here — `register-sso` commits with
// `on_success: create_user_with_sso`, and an email that already has an account
// fails that with `user_already_exists`, which the flow definition routes to
// `sso-conflict`. Recognising a returning user at all is what the identity
// link buys, and that is #1033's.
func (h *Handler) ssoOutcomeStep(ctx context.Context, state *domain.FlowState, email string) string {
	if email == "" {
		// The user declined at the provider: leave them where they were.
		return state.CurrentStep
	}
	const registerSSOStep = "register-sso"
	if !h.flowStepExists(ctx, state, registerSSOStep) {
		// A project whose flow has no provider steps (the CLI writes them with
		// `sso enable`) has nowhere to go; the current step is the safe answer.
		return state.CurrentStep
	}
	return registerSSOStep
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
func (h *Handler) exchangeSsoCode(ctx context.Context, pending ssoPending, code string) (string, error) {
	oidc, _ := pending.connection.Oidc.Get()
	tokenURL, err := tokenEndpoint(oidc)
	if err != nil {
		return "", err
	}
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", pending.returnURL+IdpCallbackPath)
	form.Set("client_id", oidc.ClientID)
	form.Set("client_secret", oidc.ClientSecret)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if h.ssoEgress == nil {
		return "", fmt.Errorf("no egress client configured for the token exchange")
	}
	resp, err := h.ssoEgress.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("token endpoint answered %d", resp.StatusCode)
	}
	var tokens struct {
		IDToken string `json:"id_token"`
	}
	if err := json.Unmarshal(body, &tokens); err != nil {
		return "", err
	}
	if tokens.IDToken == "" {
		return "", fmt.Errorf("token response carried no id_token")
	}
	return emailClaim(tokens.IDToken)
}

// emailClaim reads the email out of an id_token's payload WITHOUT verifying
// its signature. Stub only.
func emailClaim(idToken string) (string, error) {
	parts := strings.Split(idToken, ".")
	if len(parts) < 2 {
		return "", fmt.Errorf("id_token is not a JWT")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", err
	}
	var claims struct {
		Email string `json:"email"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return "", err
	}
	if claims.Email == "" {
		return "", fmt.Errorf("id_token carried no email claim")
	}
	return claims.Email, nil
}

// authorizeEndpoint prefers the connection's explicit endpoint and otherwise
// derives one from the issuer, which is what a discovery document would give.
func authorizeEndpoint(oidc api.IdpConnectionOidc) (*url.URL, error) {
	if explicit, ok := oidc.AuthorizationEndpoint.Get(); ok && explicit != "" {
		return url.Parse(explicit)
	}
	if oidc.Issuer == "" {
		return nil, fmt.Errorf("connection has no issuer")
	}
	return url.Parse(strings.TrimSuffix(oidc.Issuer, "/") + "/authorize")
}

func tokenEndpoint(oidc api.IdpConnectionOidc) (string, error) {
	if explicit, ok := oidc.TokenEndpoint.Get(); ok && explicit != "" {
		return explicit, nil
	}
	if oidc.Issuer == "" {
		return "", fmt.Errorf("connection has no issuer")
	}
	return strings.TrimSuffix(oidc.Issuer, "/") + "/token", nil
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
		out = append(out, api.SSOProvider{ID: record.id, Name: name, Template: template})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
