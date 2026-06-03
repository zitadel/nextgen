package api

import (
	"context"

	"github.com/ogen-go/ogen/ogenerrors"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain/tokengen"
)

type SecurityHandler struct {
	tokenVerifier tokengen.Verifier
}

func NewSecurityHandler(
	tokenVerifier tokengen.Verifier,
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

	payload, err := s.tokenVerifier.Verify(t.Token)
	if err != nil {
		return nil, err
	}

	var scope ScopeContext
	if projectID, ok := payload["projectID"].(string); ok {
		scope.ProjectID = projectID
	}
	if teamID, ok := payload["teamID"].(string); ok {
		scope.TeamID = teamID
	}

	ctx = WithScopeContext(ctx, scope)

	return ctx, nil
}

var _ api.SecurityHandler = (*SecurityHandler)(nil)

type contextKey struct{}

type ScopeContext struct {
	ProjectID string
	TeamID    string
}

func WithScopeContext(ctx context.Context, scopeCtx ScopeContext) context.Context {
	return context.WithValue(ctx, contextKey{}, scopeCtx)
}

func GetScopeContext(ctx context.Context) (ScopeContext, bool) {
	v, ok := ctx.Value(contextKey{}).(ScopeContext)
	return v, ok
}
