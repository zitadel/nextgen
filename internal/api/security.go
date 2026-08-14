package api

import (
	"context"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/ogen-go/ogen/ogenerrors"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

type SecurityHandler struct {
	tokenService service.TokenService
}

func NewSecurityHandler(
	tokenService service.TokenService,
) *SecurityHandler {
	return &SecurityHandler{
		tokenService: tokenService,
	}
}

func (s SecurityHandler) HandleOAuth2(ctx context.Context, operationName api.OperationName, t api.OAuth2) (context.Context, error) {
	if t.Token == "" {
		return nil, ogenerrors.ErrSecurityRequirementIsNotSatisfied
	}

	payload, err := s.tokenService.IntrospectToken(ctx, t.Token)
	if err != nil {
		return nil, ogenerrors.ErrSecurityRequirementIsNotSatisfied
	}
	if !isProjectSecretType(payload.Type) {
		return nil, ogenerrors.ErrSecurityRequirementIsNotSatisfied
	}

	scope := ScopeContext{
		ProjectID:     payload.ProjectID,
		Scope:         payload.Scope,
		PrincipalType: domain.AuthzPrincipalTypeSKProj,
		// Project secrets are JWEs without a stable key id; the project id is
		// the durable principal for sk_proj grants (survives rotate/claim).
		PrincipalID: payload.ProjectID,
	}

	ctx = WithScopeContext(ctx, scope)
	ctx = withActorFromToken(ctx, payload)
	return ctx, nil
}

// HandleNextgenSession handles the nextgenSession security scheme: the
// __nextgen_session cookie on the sessions/me and users/me operations.
// It verifies that the cookie value decrypts to a session token and stashes
// the parsed token in the context for the handlers.
func (s SecurityHandler) HandleNextgenSession(ctx context.Context, operationName api.OperationName, t api.NextgenSession) (context.Context, error) {
	token, err := s.tokenService.IntrospectToken(ctx, t.APIKey)
	if err != nil {
		return nil, ogenerrors.ErrSecurityRequirementIsNotSatisfied
	}
	err = domain.ValidateSessionToken(token)
	if err != nil {
		return nil, ogenerrors.ErrSecurityRequirementIsNotSatisfied
	}
	ctx = context.WithValue(ctx, sessionTokenKey{}, token)
	ctx = withActorFromToken(ctx, token)
	return ctx, nil
}

var _ api.SecurityHandler = (*SecurityHandler)(nil)

// sessionCookieOperations lists the operations secured by the nextgenSession
// scheme. ogen reports an absent credential as a scheme-anonymous
// "security requirement is not satisfied" error, so OgenErrorHandler decides
// the 401 message by operation name instead.
var sessionCookieOperations = map[api.OperationName]bool{
	api.GetMySessionOperation:    true,
	api.RevokeMySessionOperation: true,
	api.GetMyUserOperation:       true,
	api.CompleteClaimOperation:   true,
}

// sessionUnauthorizedMessage mirrors the 401 descriptions of the
// cookie-secured operations in api/openapi.
const sessionUnauthorizedMessage = "Missing or invalid session token."

type sessionTokenKey struct{}

// sessionTokenFromContext returns the session token parsed from the
// __nextgen_session cookie by HandleNextgenSession.
func sessionTokenFromContext(ctx context.Context) (*domain.Token, bool) {
	v, ok := ctx.Value(sessionTokenKey{}).(*domain.Token)
	return v, ok && v != nil
}

type contextKey struct{}

// requestHostKey is a context key for the effective request host injected
// by WithRequestHostMiddleware. Needed because same-origin browser fetches
// do not send the Origin header, so the handler falls back to this value.
type requestHostKey struct{}

// WithRequestHostMiddleware injects the effective request proto+host into the
// context so handlers can derive a WebAuthn RPID even when the browser omits
// the Origin header (same-origin fetches).
func WithRequestHostMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proto := r.Header.Get("X-Forwarded-Proto")
		if proto == "" {
			if r.TLS != nil {
				proto = "https"
			} else {
				proto = "http"
			}
		}
		host := r.Header.Get("X-Forwarded-Host")
		if host == "" {
			host = r.Host
		}
		if host != "" {
			ctx := context.WithValue(r.Context(), requestHostKey{}, proto+"://"+host)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func requestOriginFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(requestHostKey{}).(string)
	return v, ok && v != ""
}

// cookieSecureFromContext reports whether Set-Cookie should include Secure.
//
// HTTPS requests (including TLS terminated upstream with X-Forwarded-Proto)
// keep Secure. Loopback HTTP — http://localhost / 127.0.0.0/8 / ::1 used by
// the CLI local runtime — omits it so Safari will store and send the cookie.
// Chrome and Firefox already accept Secure cookies on localhost; Safari does
// not (WebKit bug 232088). Non-loopback HTTP keeps Secure so a mis-set
// X-Forwarded-Proto fails closed rather than silently weakening cookies.
//
// When the request host was never injected (callers that skip
// WithRequestHostMiddleware), or the origin cannot be parsed, default to
// Secure=true so production-shaped paths stay locked down.
func cookieSecureFromContext(ctx context.Context) bool {
	origin, ok := requestOriginFromContext(ctx)
	if !ok {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil || u.Hostname() == "" {
		return true
	}
	if strings.EqualFold(u.Scheme, "https") {
		return true
	}
	if strings.EqualFold(u.Scheme, "http") && isLoopbackHost(u.Hostname()) {
		return false
	}
	return true
}

// isLoopbackHost reports whether host is localhost or a loopback IP
// (127.0.0.0/8, ::1). Host must already be stripped of any port.
func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

type ScopeContext struct {
	ProjectID string
	// Scope carries the token's minted scopes verbatim (domain.Token.Scope):
	// project secrets hold project.write + project.read, preview secrets hold
	// project.read only. The authz gate requires project.write as a ceiling on
	// top of resolver.Check — preview cannot call management APIs at all.
	Scope []string
	// PrincipalType / PrincipalID identify the authz principal for resolver.Check.
	// OAuth2 project secrets are sk_proj with PrincipalID == ProjectID.
	PrincipalType domain.AuthzPrincipalType
	PrincipalID   string
}

func WithScopeContext(ctx context.Context, scopeCtx ScopeContext) context.Context {
	return context.WithValue(ctx, contextKey{}, scopeCtx)
}

func GetScopeContext(ctx context.Context) (ScopeContext, bool) {
	v, ok := ctx.Value(contextKey{}).(ScopeContext)
	return v, ok
}

func isProjectSecretType(t domain.TokenType) bool {
	return t == domain.TokenTypeProjectToken || t == domain.TokenTypeProjectPreview
}

func withActorFromToken(ctx context.Context, token *domain.Token) context.Context {
	if token == nil {
		return ctx
	}
	ac := audit.ActorContext{
		ProjectID:      token.ProjectID,
		TokenID:        token.TokenID,
		DelegationType: "direct",
		Authenticated:  true,
		SessionID:      token.SessionID,
	}
	if token.UserID != "" {
		uid := token.UserID
		ac.ActorID = &uid
		actorType := domain.EventActorTypeHuman
		if token.Type == domain.TokenTypePersonalAccessToken {
			actorType = domain.EventActorTypeService
		}
		ac.ActorType = &actorType
	} else {
		actorType := domain.EventActorTypeService
		ac.ActorType = &actorType
	}
	if reqID, ok := middleware.GetRequestIDContext(ctx); ok {
		ac.RequestID = &reqID
	}
	if rc, ok := middleware.GetRequestContext(ctx); ok {
		if rc.Fingerprint != "" {
			ac.Fingerprint = rc.Fingerprint
		}
		if rc.FlowID != "" {
			flowID := rc.FlowID
			ac.FlowID = &flowID
		}
		if rc.SessionID != "" && ac.SessionID == nil {
			sid := rc.SessionID
			ac.SessionID = &sid
		}
	}
	return audit.WithActorContext(ctx, ac)
}
