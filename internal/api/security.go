package api

import (
	"context"
	"errors"
	"strings"

	"github.com/ogen-go/ogen/ogenerrors"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type SecurityHandler struct {
	pool               database.Pool
	projects           domain.ProjectRepository
	claimStatusSecrets ClaimStatusSecretResolver
}

type SecurityHandlerOption func(*SecurityHandler)

type ClaimStatusSecretResolver interface {
	ProjectIDByClaimStatusSecret(ctx context.Context, secret string) (string, error)
}

func WithProjectRepository(pool database.Pool, projects domain.ProjectRepository) SecurityHandlerOption {
	return func(s *SecurityHandler) {
		s.pool = pool
		s.projects = projects
	}
}

func WithClaimStatusSecretResolver(resolver ClaimStatusSecretResolver) SecurityHandlerOption {
	return func(s *SecurityHandler) {
		s.claimStatusSecrets = resolver
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
	if !strings.HasPrefix(t.Token, "sk_proj_") {
		return nil, ogenerrors.ErrSecurityRequirementIsNotSatisfied
	}
	scopeCtx := ScopeContext{ProjectSecret: t.Token}
	if s.projects == nil || s.pool == nil {
		return WithScopeContext(ctx, scopeCtx), nil
	}
	project, err := s.projects.GetBySecret(ctx, s.pool, t.Token)
	if err == nil {
		scopeCtx.ProjectID = project.ID
		return WithScopeContext(ctx, scopeCtx), nil
	}
	var noRow *database.NoRowFoundError
	if !errors.As(err, &noRow) {
		return nil, err
	}
	if operationName == api.GetProjectClaimStatusOperation && s.claimStatusSecrets != nil {
		projectID, err := s.claimStatusSecrets.ProjectIDByClaimStatusSecret(ctx, t.Token)
		if err == nil {
			scopeCtx.ProjectID = projectID
			return WithScopeContext(ctx, scopeCtx), nil
		}
		if !errors.As(err, &noRow) {
			return nil, err
		}
	}
	return nil, ogenerrors.ErrSecurityRequirementIsNotSatisfied
}

var _ api.SecurityHandler = (*SecurityHandler)(nil)

func NewSecurityHandler(options ...SecurityHandlerOption) *SecurityHandler {
	handler := &SecurityHandler{}
	for _, option := range options {
		option(handler)
	}
	return handler
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
