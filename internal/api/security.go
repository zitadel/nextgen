package api

import (
	"context"
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
	return WithScopeContext(ctx, ScopeContext{
		ProjectID:     projectID,
		ProjectSecret: t.Token,
	}), nil
}

var _ api.SecurityHandler = (*SecurityHandler)(nil)

func NewSecurityHandler() *SecurityHandler {
	return &SecurityHandler{}
}

type contextKey struct{}

type ScopeContext struct {
	ProjectID     string
	ProjectSecret string
}

func WithScopeContext(ctx context.Context, scopeCtx ScopeContext) context.Context {
	return context.WithValue(ctx, contextKey{}, scopeCtx)
}

func GetScopeContext(ctx context.Context) (ScopeContext, bool) {
	v, ok := ctx.Value(contextKey{}).(ScopeContext)
	return v, ok
}
