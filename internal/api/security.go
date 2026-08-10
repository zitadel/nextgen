package api

import (
	"context"
	"net/http"

	"github.com/ogen-go/ogen/ogenerrors"
	api "github.com/zitadel/nextgen/api/generated"
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

	payload, err := s.tokenService.VerifyToken(ctx, t.Token)
	if err != nil {
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

	return ctx, nil
}

// HandleNextgenSession handles the nextgenSession security scheme: the
// __nextgen_session cookie on the sessions/me and users/me operations.
// It verifies that the cookie value decrypts to a session token and stashes
// the parsed token in the context for the handlers.
func (s SecurityHandler) HandleNextgenSession(ctx context.Context, operationName api.OperationName, t api.NextgenSession) (context.Context, error) {
	token, err := s.tokenService.VerifyToken(ctx, t.APIKey)
	if err != nil {
		return nil, ogenerrors.ErrSecurityRequirementIsNotSatisfied
	}
	err = domain.ValidateSessionToken(token)
	if err != nil {
		return nil, ogenerrors.ErrSecurityRequirementIsNotSatisfied
	}
	return context.WithValue(ctx, sessionTokenKey{}, token), nil
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

type ScopeContext struct {
	ProjectID string
	// Scope carries the token's minted scopes verbatim (domain.Token.Scope):
	// project secrets hold project.write + project.read, preview secrets hold
	// project.read only. The authz gate uses this as a credential-class ceiling
	// (preview may only satisfy viewer-mapped reads) on top of resolver checks.
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
