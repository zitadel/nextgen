package api

import (
	"errors"
	"testing"

	"github.com/ogen-go/ogen/ogenerrors"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service/mocks"
	"go.uber.org/mock/gomock"
)

func TestHandleOAuth2(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name  string
		token *domain.Token
	}{
		{
			name: "project token mints sk_proj scope",
			token: &domain.Token{
				ProjectID: "project-1",
				TokenID:   "token-1",
				Type:      domain.TokenTypeProjectToken,
				Scope:     []string{"project.write", "project.read"},
			},
		},
		{
			name: "preview token mints sk_proj scope",
			token: &domain.Token{
				ProjectID: "project-1",
				TokenID:   "token-preview",
				Type:      domain.TokenTypeProjectPreview,
				Scope:     []string{"project.read"},
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			mock := gomock.NewController(t)
			tokenService := mocks.NewMockTokenService(mock)
			tokenService.EXPECT().IntrospectToken(gomock.Any(), "raw-bearer").Return(tc.token, nil)

			handler := NewSecurityHandler(tokenService)
			ctx, err := handler.HandleOAuth2(t.Context(), api.InitClaimOperation, api.OAuth2{Token: "raw-bearer"})
			require.NoError(t, err)

			got, ok := GetScopeContext(ctx)
			require.True(t, ok)
			require.Equal(t, tc.token.ProjectID, got.ProjectID)
			require.Equal(t, domain.AuthzPrincipalTypeSKProj, got.PrincipalType)
			require.Equal(t, tc.token.ProjectID, got.PrincipalID)
			require.Equal(t, tc.token.Scope, got.Scope)
			require.Equal(t, domain.HashSecret("raw-bearer"), got.SecretHash)
		})
	}

	t.Run("secret hash is only computed for the claim operations", func(t *testing.T) {
		t.Parallel()

		token := &domain.Token{
			ProjectID: "project-1",
			TokenID:   "token-1",
			Type:      domain.TokenTypeProjectToken,
			Scope:     []string{"project.write", "project.read"},
		}
		mock := gomock.NewController(t)
		tokenService := mocks.NewMockTokenService(mock)
		tokenService.EXPECT().IntrospectToken(gomock.Any(), "raw-bearer").Return(token, nil)

		handler := NewSecurityHandler(tokenService)
		ctx, err := handler.HandleOAuth2(t.Context(), api.GetProjectOperation, api.OAuth2{Token: "raw-bearer"})
		require.NoError(t, err)

		got, ok := GetScopeContext(ctx)
		require.True(t, ok)
		require.Empty(t, got.SecretHash)
	})

	t.Run("empty token is an unsatisfied requirement", func(t *testing.T) {
		t.Parallel()

		handler := NewSecurityHandler(nil)
		_, err := handler.HandleOAuth2(t.Context(), api.GetProjectOperation, api.OAuth2{Token: ""})
		require.ErrorIs(t, err, ogenerrors.ErrSecurityRequirementIsNotSatisfied)
	})

	t.Run("introspect error is an unsatisfied requirement", func(t *testing.T) {
		t.Parallel()

		mock := gomock.NewController(t)
		tokenService := mocks.NewMockTokenService(mock)
		tokenService.EXPECT().IntrospectToken(gomock.Any(), "garbage").Return(nil, errors.New("bad token"))

		handler := NewSecurityHandler(tokenService)
		_, err := handler.HandleOAuth2(t.Context(), api.GetProjectOperation, api.OAuth2{Token: "garbage"})
		require.ErrorIs(t, err, ogenerrors.ErrSecurityRequirementIsNotSatisfied)
	})

	for _, tc := range []struct {
		name      string
		tokenType domain.TokenType
	}{
		{name: "unspecified token", tokenType: domain.TokenTypeUnspecified},
		{name: "session token", tokenType: domain.TokenTypeSessionToken},
		{name: "oidc access token", tokenType: domain.TokenTypeOIDCAccessToken},
		{name: "personal access token", tokenType: domain.TokenTypePersonalAccessToken},
	} {
		t.Run(tc.name+" is rejected", func(t *testing.T) {
			t.Parallel()

			token := &domain.Token{Type: tc.tokenType, ProjectID: "project-1"}
			mock := gomock.NewController(t)
			tokenService := mocks.NewMockTokenService(mock)
			tokenService.EXPECT().IntrospectToken(gomock.Any(), "raw-bearer").Return(token, nil)

			handler := NewSecurityHandler(tokenService)
			_, err := handler.HandleOAuth2(t.Context(), api.GetProjectOperation, api.OAuth2{Token: "raw-bearer"})
			require.ErrorIs(t, err, ogenerrors.ErrSecurityRequirementIsNotSatisfied)
		})
	}
}

func TestHandleNextgenSession(t *testing.T) {
	t.Parallel()

	t.Run("valid token is stashed in context", func(t *testing.T) {
		t.Parallel()

		token := &domain.Token{
			ProjectID: "project-1",
			TokenID:   "token-1",
			Type:      domain.TokenTypeSessionToken,
			SessionID: new("session-1"),
		}

		mock := gomock.NewController(t)
		tokenService := mocks.NewMockTokenService(mock)
		tokenService.EXPECT().IntrospectToken(gomock.Any(), "raw-cookie").Return(token, nil)

		handler := NewSecurityHandler(tokenService)
		ctx, err := handler.HandleNextgenSession(t.Context(), api.GetMySessionOperation, api.NextgenSession{APIKey: "raw-cookie"})
		require.NoError(t, err)

		got, ok := sessionTokenFromContext(ctx)
		require.True(t, ok)
		require.Equal(t, token, got)
		_, ok = GetScopeContext(ctx)
		require.False(t, ok, "anonymous session must not mint ScopeContext")
	})

	t.Run("user-bound session mints user ScopeContext", func(t *testing.T) {
		t.Parallel()

		token := &domain.Token{
			ProjectID: "project-1",
			TokenID:   "token-1",
			UserID:    "user-1",
			Type:      domain.TokenTypeSessionToken,
			SessionID: new("session-1"),
		}

		mock := gomock.NewController(t)
		tokenService := mocks.NewMockTokenService(mock)
		tokenService.EXPECT().IntrospectToken(gomock.Any(), "raw-cookie").Return(token, nil)

		handler := NewSecurityHandler(tokenService)
		ctx, err := handler.HandleNextgenSession(t.Context(), api.GetMySessionOperation, api.NextgenSession{APIKey: "raw-cookie"})
		require.NoError(t, err)

		scope, ok := GetScopeContext(ctx)
		require.True(t, ok)
		require.Equal(t, "project-1", scope.ProjectID)
		require.Equal(t, domain.AuthzPrincipalTypeUser, scope.PrincipalType)
		require.Equal(t, "user-1", scope.PrincipalID)
		require.Empty(t, scope.Scope, "session tokens mint an empty Scope; the user skip must not depend on project.write")
	})

	t.Run("session write scopes still mint a user principal", func(t *testing.T) {
		t.Parallel()

		token := &domain.Token{
			ProjectID: "project-1",
			TokenID:   "token-1",
			UserID:    "user-1",
			Type:      domain.TokenTypeSessionToken,
			Scope:     []string{"project.write", "project.read"},
			SessionID: new("session-1"),
		}

		mock := gomock.NewController(t)
		tokenService := mocks.NewMockTokenService(mock)
		tokenService.EXPECT().IntrospectToken(gomock.Any(), "raw-cookie").Return(token, nil)

		handler := NewSecurityHandler(tokenService)
		ctx, err := handler.HandleNextgenSession(t.Context(), api.CreateGrantOperation, api.NextgenSession{APIKey: "raw-cookie"})
		require.NoError(t, err)

		scope, ok := GetScopeContext(ctx)
		require.True(t, ok)
		require.Equal(t, domain.AuthzPrincipalTypeUser, scope.PrincipalType)
		require.Equal(t, "user-1", scope.PrincipalID)
		require.Equal(t, token.Scope, scope.Scope)
		require.NotEqual(t, domain.AuthzPrincipalTypeSKProj, scope.PrincipalType)
	})

	t.Run("invalid token is an unsatisfied requirement", func(t *testing.T) {
		t.Parallel()

		mock := gomock.NewController(t)
		tokenService := mocks.NewMockTokenService(mock)
		tokenService.EXPECT().IntrospectToken(gomock.Any(), "garbage").Return(nil, errors.New("bad token"))

		handler := NewSecurityHandler(tokenService)
		_, err := handler.HandleNextgenSession(t.Context(), api.GetMySessionOperation, api.NextgenSession{APIKey: "garbage"})
		require.ErrorIs(t, err, ogenerrors.ErrSecurityRequirementIsNotSatisfied)
	})

	t.Run("non-session token type is rejected", func(t *testing.T) {
		t.Parallel()

		token := &domain.Token{Type: domain.TokenTypeOIDCAccessToken}

		mock := gomock.NewController(t)
		tokenService := mocks.NewMockTokenService(mock)
		tokenService.EXPECT().IntrospectToken(gomock.Any(), "raw-cookie").Return(token, nil)

		handler := NewSecurityHandler(tokenService)
		_, err := handler.HandleNextgenSession(t.Context(), api.GetMySessionOperation, api.NextgenSession{APIKey: "raw-cookie"})
		require.ErrorIs(t, err, ogenerrors.ErrSecurityRequirementIsNotSatisfied)
	})
}
