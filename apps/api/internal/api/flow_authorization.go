package api

import (
	"context"
	"net/http"
	"strings"
	"time"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// AuthRequestResolver opens the authorization request a page starts a flow
// for (ADR 081 §8): the handle from the login page's URL, checked against the
// cookie that binds it to the browser that made it.
type AuthRequestResolver interface {
	ResolveAuthRequest(ctx context.Context, projectID, handle string, cookie func(name string) (string, bool)) (*domain.FlowAuthRequest, error)
}

// WithAuthRequests wires the authorization server whose requests flows
// answer. Without one, a flow started with an auth_request_id fails.
func (h *Handler) WithAuthRequests(r AuthRequestResolver) *Handler {
	h.authRequests = r
	return h
}

// startAuthorization adds the authorization request a flow is started for to
// the start request, with the user the browser's live session names: the flow
// answers for that user without a sign-in, unless the request says otherwise.
func (h *Handler) startAuthorization(ctx context.Context, projectID, handle string, start *service.StartFlowRequest) error {
	if h.authRequests == nil {
		return domain.ErrFlowAuthRequestInvalid()
	}
	req, err := h.authRequests.ResolveAuthRequest(ctx, projectID, handle, func(name string) (string, bool) {
		return requestCookieFromContext(ctx, name)
	})
	if err != nil {
		return err
	}
	user, err := h.liveSessionUser(ctx, projectID)
	if err != nil {
		return err
	}
	start.AuthRequest = req
	start.SessionUserID = user
	return nil
}

// liveSessionUser is the user the browser's session cookie names in the
// project, or "" when it names none: no cookie, a rejected or ended session,
// another project's, or one no one signed in to. Only a failure to decide is
// an error.
func (h *Handler) liveSessionUser(ctx context.Context, projectID string) (string, error) {
	cookie, ok := requestCookieFromContext(ctx, sessionCookieName)
	if !ok || h.tokenService == nil {
		return "", nil
	}
	token, err := h.tokenService.IntrospectToken(ctx, cookie)
	if err != nil {
		if isRejectedToken(err) {
			return "", nil
		}
		return "", introspectionFailure(err)
	}
	if domain.ValidateSessionToken(token) != nil || token.ProjectID != projectID {
		return "", nil
	}
	self, err := domain.SelfFromSession(token, time.Now())
	if err != nil {
		return "", nil
	}
	return self.UserID(), nil
}

// appendAuthRequestClear adds the deletion of the request's binding cookie
// to a terminal response's cookies: the request is answered, and its handle
// starts no other flow in this browser.
func appendAuthRequestClear(_ context.Context, cookies []string, state *domain.FlowState, terminal bool) []string {
	if !terminal || state == nil || state.AuthRequest == nil {
		return cookies
	}
	name := state.AuthRequest.BindingCookie
	if name == "" {
		return cookies
	}
	// A __Host- cookie is only replaced by one that is Secure too.
	secure := strings.HasPrefix(name, "__Host-")
	return append(cookies, (&http.Cookie{
		Name:     name,
		Value:    "",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		Path:     "/",
		MaxAge:   -1,
	}).String())
}

// requestCookiesKey carries the request, for the handlers that read a cookie
// the spec cannot name: an authorization request's binding cookie is named
// per request (ADR 081 §8).
type requestCookiesKey struct{}

// WithRequestCookies lets handlers read the request's cookies by name. Mount
// it after WithLoopbackSessionCookie, so the session cookie reads under its
// canonical name on a loopback host too.
func WithRequestCookies(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestCookiesKey{}, r)))
	})
}

func requestCookieFromContext(ctx context.Context, name string) (string, bool) {
	r, ok := ctx.Value(requestCookiesKey{}).(*http.Request)
	if !ok {
		return "", false
	}
	cookie, err := r.Cookie(name)
	if err != nil || cookie.Value == "" {
		return "", false
	}
	return cookie.Value, true
}

func toFlowClient(c domain.FlowClient) api.FlowClient {
	out := api.FlowClient{
		ID:           c.ID,
		Name:         c.Name,
		RedirectHost: c.RedirectHost,
		Party:        api.FlowClientPartyThirdParty,
	}
	if c.FirstParty {
		out.Party = api.FlowClientPartyFirstParty
	}
	if c.LogoURI != "" {
		if u, err := parseURI(c.LogoURI); err == nil {
			out.LogoURI = api.NewOptURI(u)
		}
	}
	return out
}

func toFlowConsent(c domain.FlowStepConsent) api.FlowConsent {
	out := api.FlowConsent{
		API:    api.FlowConsentAPI{Name: c.API.Name},
		Scopes: make([]api.FlowConsentScopesItem, 0, len(c.Scopes)),
	}
	if u, err := parseURI(c.API.Identifier); err == nil {
		out.API.Identifier = u
	}
	for _, scope := range c.Scopes {
		out.Scopes = append(out.Scopes, api.FlowConsentScopesItem{Name: scope.Name, TextKey: scope.TextKey})
	}
	return out
}
