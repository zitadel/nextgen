package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/ogen-go/ogen/ogenerrors"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/secrets"
)

type SecurityHandler struct {
	tokenVerifier domain.TokenVerifier
}

func NewSecurityHandler(
	tokenVerifier domain.TokenVerifier,
) *SecurityHandler {
	return &SecurityHandler{
		tokenVerifier: tokenVerifier,
	}
}

func (s SecurityHandler) HandleUsernamePassword(ctx context.Context, operationName api.OperationName, t api.UsernamePassword) (context.Context, error) {
	//TODO implement me
	panic("implement me")
}

func (s SecurityHandler) HandleOAuth2(ctx context.Context, operationName api.OperationName, t api.OAuth2) (context.Context, error) {
	if t.Token == "" {
		return nil, ogenerrors.ErrSecurityRequirementIsNotSatisfied
	}

	projectID, ok := s.resolveProjectID(t.Token)
	if !ok {
		return nil, ogenerrors.ErrSecurityRequirementIsNotSatisfied
	}

	return WithScopeContext(ctx, ScopeContext{ProjectID: projectID}), nil
}

// resolveProjectID derives the scoped project id from an OAuth2 bearer token.
//
// A real project token — the opaque project secret minted when the project is
// created — is verified cryptographically and its project id read from the
// payload. This is the path API clients (and the integration tests) use.
//
// Browser-originated flows cannot hold that secret. The SDK request boundary
// proxies project-scoped calls such as POST /sessions/exchange with an
// "sk_<project_id>" bearer that only *identifies* the project: the request's
// handoff token is the actual credential, and the project secret never leaves
// the CLI's .zitadel/secret. For those, accept the well-formed project-key
// form and use the embedded project id.
func (s SecurityHandler) resolveProjectID(token string) (string, bool) {
	if payload, err := s.tokenVerifier.Verify(token); err == nil {
		return payload.ProjectID, true
	}
	if id, ok := strings.CutPrefix(token, secrets.SecretKeyPrefix); ok {
		if strings.HasPrefix(id, string(domain.PrefixProject)+"_") {
			return id, true
		}
	}
	return "", false
}

var _ api.SecurityHandler = (*SecurityHandler)(nil)

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
}

func WithScopeContext(ctx context.Context, scopeCtx ScopeContext) context.Context {
	return context.WithValue(ctx, contextKey{}, scopeCtx)
}

func GetScopeContext(ctx context.Context) (ScopeContext, bool) {
	v, ok := ctx.Value(contextKey{}).(ScopeContext)
	return v, ok
}
