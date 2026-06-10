package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/ogen-go/ogen/ogenerrors"
	api "github.com/zitadel/nextgen/api/generated"
)

type SecurityHandler struct {
}

func (s SecurityHandler) HandleUsernamePassword(ctx context.Context, operationName api.OperationName, t api.UsernamePassword) (context.Context, error) {
	//TODO implement me
	panic("implement me")
}

func (s SecurityHandler) HandleOAuth2(ctx context.Context, operationName api.OperationName, t api.OAuth2) (context.Context, error) {
	if t.Token == "" {
		return nil, ogenerrors.ErrSecurityRequirementIsNotSatisfied
	}
	// TODO: add proper token validation
	projectID, ok := strings.CutPrefix(t.Token, "sk_")
	if !ok {
		return nil, ogenerrors.ErrSecurityRequirementIsNotSatisfied
	}
	if !strings.HasPrefix(projectID, "proj_") {
		return nil, ogenerrors.ErrSecurityRequirementIsNotSatisfied
	}
	return WithScopeContext(ctx, ScopeContext{ProjectID: projectID}), nil
}

var _ api.SecurityHandler = (*SecurityHandler)(nil)

func NewSecurityHandler() *SecurityHandler {
	return &SecurityHandler{}
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
}

func WithScopeContext(ctx context.Context, scopeCtx ScopeContext) context.Context {
	return context.WithValue(ctx, contextKey{}, scopeCtx)
}

func GetScopeContext(ctx context.Context) (ScopeContext, bool) {
	v, ok := ctx.Value(contextKey{}).(ScopeContext)
	return v, ok
}
